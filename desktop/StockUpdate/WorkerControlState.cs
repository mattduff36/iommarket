namespace StockUpdate;

public readonly record struct WorkerActivityItem(int Sequence, string Code, DateTimeOffset At);

public interface IWorkerControlUi
{
    void Post(Action action);
    void OnConnected();
    void OnRemoteCommand(int generation, string action);
    void OnControlLost(string errorCode);
}

public sealed class WorkerControlState
{
    public const int MaxEvents = 40;
    public static readonly TimeSpan Retain = TimeSpan.FromHours(23);
    private readonly object _gate = new();
    private readonly List<WorkerActivityItem> _activity = new();
    private readonly HashSet<Guid> _seen = new();
    private int _sequence;

    public Guid InstanceId { get; private set; } = Guid.NewGuid();
    public int Generation { get; private set; }
    public string RuntimeState { get; private set; } = "connected";
    public Guid? AcknowledgedCommandId { get; private set; }
    public bool Paused { get; private set; }
    public bool StopWorker { get; private set; }

    public static bool IsActivity(string? code) => code is "checking" or "ready" or "waiting" or "processing"
        or "staging-photos" or "processing-finished" or "applied" or "stopping" or "stopped" or "error";

    public static bool IsRuntime(string? state) =>
        state is "connected" or "waiting" or "running" or "stopping" or "stopped" or "error";

    public void Record(string code, DateTimeOffset now)
    {
        if (!IsActivity(code)) return;
        var at = now.ToUniversalTime();
        lock (_gate)
        {
            if (Paused) return;
            Prune(at);
            if (code == "waiting" && _activity.Count > 0 && _activity[^1].Code == "waiting") return;
            _sequence++;
            _activity.Add(new WorkerActivityItem(_sequence, code, at));
            while (_activity.Count > MaxEvents) _activity.RemoveAt(0);
        }
    }

    public void NoteWorker(string code)
    {
        if (!IsActivity(code)) return;
        lock (_gate)
        {
            if (Paused || StopWorker) return;
            RuntimeState = code switch
            {
                "waiting" => "waiting",
                "stopping" => "stopping",
                "stopped" => "stopped",
                "error" => "error",
                _ => "running"
            };
        }
    }

    public bool TryAccept(Guid id, Guid instanceId, string action, out int generation, out bool execute)
    {
        execute = false;
        generation = 0;
        if (action is not ("start" or "stop")) return false;
        lock (_gate)
        {
            if (Paused || instanceId != InstanceId) return false;
            var replay = !_seen.Add(id);
            AcknowledgedCommandId = id;
            generation = Generation;
            if (replay) return true;
            if (action == "stop" || StopWorker)
            {
                Generation++;
                generation = Generation;
                StopWorker = true;
                RuntimeState = "stopping";
                execute = action == "stop";
                return true;
            }
            StopWorker = false;
            RuntimeState = "running";
            execute = true;
            return true;
        }
    }

    public bool CompleteStart(int generation)
    {
        lock (_gate)
        {
            if (Paused || StopWorker || generation != Generation) return false;
            RuntimeState = "running";
            return true;
        }
    }

    public bool IsStale(int generation)
    {
        lock (_gate) return Paused || StopWorker || generation != Generation;
    }

    public void FailStart()
    {
        lock (_gate)
        {
            if (Paused || StopWorker) return;
            RuntimeState = "error";
        }
    }

    public void ObserveExit()
    {
        lock (_gate)
        {
            if (Paused) return;
            if (StopWorker || RuntimeState is "stopping" or "stopped")
            {
                StopWorker = false;
                RuntimeState = "stopped";
                return;
            }
            RuntimeState = "error";
        }
    }

    public void LocalStop()
    {
        lock (_gate)
        {
            Generation++;
            InstanceId = Guid.NewGuid();
            AcknowledgedCommandId = null;
            _seen.Clear();
            StopWorker = true;
            if (!Paused) RuntimeState = "stopping";
        }
    }

    public void MarkStopped()
    {
        lock (_gate)
        {
            StopWorker = false;
            if (!Paused) RuntimeState = "stopped";
        }
    }

    public void OnControlLost()
    {
        lock (_gate)
        {
            Generation++;
            Paused = true;
            StopWorker = true;
            RuntimeState = "error";
        }
    }

    public WorkerActivityItem[] Snapshot(DateTimeOffset now, out Guid instanceId, out string state, out Guid? acknowledged)
    {
        lock (_gate)
        {
            Prune(now.ToUniversalTime());
            instanceId = InstanceId;
            state = RuntimeState;
            acknowledged = AcknowledgedCommandId;
            return _activity.ToArray();
        }
    }

    private void Prune(DateTimeOffset now)
    {
        var cutoff = now - Retain;
        _activity.RemoveAll(item => item.At < cutoff);
    }
}

public sealed class WorkerControlController : IDisposable
{
    private readonly WorkerControlClient _client;
    private readonly string _bearer;
    private readonly IWorkerControlUi _ui;
    private readonly CancellationTokenSource _cancel = new();
    private readonly CancellationToken _token;
    private int _started;
    public WorkerControlState State { get; } = new();

    public WorkerControlController(AppEnvironment environment, string bearer, IWorkerControlUi ui, HttpMessageHandler? handler = null)
    {
        _token = _cancel.Token;
        _bearer = bearer;
        _ui = ui;
        _client = handler is null ? WorkerControlClient.Create(environment) : new WorkerControlClient(environment, handler, ownsHandler: false);
    }

    public void Start()
    {
        if (Interlocked.Exchange(ref _started, 1) != 0) return;
        _ = Task.Run(RunAsync);
    }

    public void Cancel() => _cancel.Cancel();

    private async Task RunAsync()
    {
        var announced = false;
        var token = _token;
        try
        {
            while (!token.IsCancellationRequested)
            {
                var activity = State.Snapshot(DateTimeOffset.UtcNow, out var instanceId, out var runtime, out var ack);
                var call = await _client.HeartbeatAsync(instanceId, runtime, activity, ack, _bearer, token);
                if (!call.Ok)
                {
                    if (call.ErrorCode == "cancelled") return;
                    State.OnControlLost();
                    var code = call.ErrorCode;
                    _ui.Post(() => _ui.OnControlLost(code));
                    return;
                }
                if (!announced)
                {
                    announced = true;
                    _ui.Post(_ui.OnConnected);
                }
                if (call.Value is { } command && State.TryAccept(command.Id, command.InstanceId, command.Action, out var generation, out var execute) && execute)
                {
                    var action = command.Action;
                    var ticket = generation;
                    _ui.Post(() => _ui.OnRemoteCommand(ticket, action));
                }
                await Task.Delay(WorkerControlClient.HeartbeatInterval, token);
            }
        }
        catch (OperationCanceledException) { }
        finally { _client.Dispose(); }
    }

    public void Dispose()
    {
        _cancel.Cancel();
        _cancel.Dispose();
    }
}
