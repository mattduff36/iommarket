import { Alert } from "@/components/ui/alert";

interface FormErrorSummaryProps {
  messages: string[];
  title?: string;
  cause?: "validation" | "service";
}

const SERVICE_MESSAGE =
  /couldn't|could not|unavailable|too many attempts|wait \d+ seconds|check the result|check before|contact support|didn't finish|connection/i;

function summaryTitle(
  messages: string[],
  cause: FormErrorSummaryProps["cause"],
  title?: string,
): string {
  if (title) return title;
  const service =
    cause === "service" ||
    (cause !== "validation" && messages.every((message) => SERVICE_MESSAGE.test(message)));
  return service ? "Please review the request status:" : "Please review the following:";
}

export function FormErrorSummary({
  messages,
  title,
  cause,
}: FormErrorSummaryProps) {
  if (messages.length === 0) return null;

  if (messages.length === 1) {
    return (
      <Alert status="error">
        <p>{messages[0]}</p>
      </Alert>
    );
  }

  return (
    <Alert status="error">
      <p className="font-medium">{summaryTitle(messages, cause, title)}</p>
      <ul className="mt-1 list-disc space-y-1 pl-4">
        {messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </Alert>
  );
}
