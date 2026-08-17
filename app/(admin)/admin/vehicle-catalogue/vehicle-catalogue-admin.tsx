"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  exportVehicleCatalogue,
  importVehicleCatalogue,
  saveVehicleMake,
  saveVehicleModel,
  saveVehicleModelAlias,
} from "@/actions/vehicle-catalogue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface CatalogueAlias {
  id: string;
  modelId: string;
  name: string;
  active: boolean;
  sortOrder: number;
  source: string;
  sourceVersion: string;
  importedAt: Date;
}

interface CatalogueModel {
  id: string;
  makeId: string;
  name: string;
  active: boolean;
  sortOrder: number;
  source: string;
  sourceVersion: string;
  importedAt: Date;
  aliases: CatalogueAlias[];
}

interface CatalogueMake {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
  source: string;
  sourceVersion: string;
  importedAt: Date;
  models: CatalogueModel[];
}

type EditorKind = "make" | "model" | "alias";

interface EditorValue {
  id?: string;
  name?: string;
  active?: boolean;
  sortOrder?: number;
  source?: string;
  sourceVersion?: string;
  makeId?: string;
  modelId?: string;
}

function toMessage(error: unknown) {
  if (typeof error === "string") return error;
  return "Check the highlighted values and try again.";
}

function EntityEditor({
  kind,
  value = {},
  compact = false,
  onComplete,
}: {
  kind: EditorKind;
  value?: EditorValue;
  compact?: boolean;
  onComplete: (message: string) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const label = kind === "make" ? "make" : kind === "model" ? "model" : "alias";

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const common = {
      id: value.id,
      name: String(form.get("name") ?? ""),
      active: form.get("active") === "on",
      sortOrder: Number(form.get("sortOrder") ?? 0),
      source: String(form.get("source") ?? ""),
      sourceVersion: String(form.get("sourceVersion") ?? ""),
    };

    startTransition(async () => {
      const result =
        kind === "make"
          ? await saveVehicleMake(common)
          : kind === "model"
            ? await saveVehicleModel({ ...common, makeId: value.makeId ?? "" })
            : await saveVehicleModelAlias({
                ...common,
                modelId: value.modelId ?? "",
              });
      if (result.error) {
        setError(toMessage(result.error));
        return;
      }
      if (!value.id) formElement.reset();
      onComplete(`${label[0].toUpperCase()}${label.slice(1)} saved.`);
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={
        compact
          ? "grid gap-2 border-t border-border/70 pt-3 sm:grid-cols-[minmax(10rem,1fr)_6rem_minmax(8rem,0.8fr)_minmax(8rem,0.8fr)_auto]"
          : "grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(12rem,1fr)_7rem_minmax(10rem,0.8fr)_minmax(10rem,0.8fr)_auto]"
      }
    >
      <Input
        label={compact ? undefined : "Name"}
        name="name"
        required
        minLength={1}
        maxLength={80}
        defaultValue={value.name}
        placeholder={`Add ${label}`}
        className="text-base sm:text-sm"
      />
      <Input
        label={compact ? undefined : "Order"}
        name="sortOrder"
        type="number"
        required
        min={-100000}
        max={100000}
        defaultValue={value.sortOrder ?? 0}
        aria-label={compact ? `${label} order` : undefined}
        className="text-base sm:text-sm"
      />
      <Input
        label={compact ? undefined : "Source"}
        name="source"
        required
        maxLength={120}
        defaultValue={value.source ?? "admin"}
        aria-label={compact ? `${label} source` : undefined}
        className="text-base sm:text-sm"
      />
      <Input
        label={compact ? undefined : "Source version"}
        name="sourceVersion"
        required
        maxLength={120}
        defaultValue={value.sourceVersion ?? "manual-v1"}
        aria-label={compact ? `${label} source version` : undefined}
        className="text-base sm:text-sm"
      />
      <div className="flex items-center gap-2 self-end pb-1">
        <label className="inline-flex min-h-10 items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            name="active"
            defaultChecked={value.active ?? true}
            className="h-5 w-5"
          />
          Active
        </label>
        <Button type="submit" size="sm" loading={isPending}>
          {value.id ? "Save" : "Add"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-text-error sm:col-span-full">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function VehicleCatalogueAdmin({
  makes,
  query,
}: {
  makes: CatalogueMake[];
  query: string;
}) {
  const router = useRouter();
  const [isImportPending, startImportTransition] = useTransition();
  const [isExportPending, startExportTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [importJson, setImportJson] = useState("");
  const [dryRunJson, setDryRunJson] = useState<string | null>(null);
  const [confirmDeactivation, setConfirmDeactivation] = useState(false);
  const requestsDeactivation = (() => {
    try {
      const parsed = JSON.parse(importJson) as { deactivateMissing?: unknown };
      return parsed.deactivateMissing === true;
    } catch {
      return false;
    }
  })();
  const deactivationReady =
    !requestsDeactivation ||
    (dryRunJson === importJson && confirmDeactivation);

  function completed(message: string) {
    setStatus(message);
    router.refresh();
  }

  function runImport(dryRun: boolean) {
    setStatus(null);
    startImportTransition(async () => {
      const result = await importVehicleCatalogue({
        json: importJson,
        dryRun,
        confirmDeactivateMissing:
          !dryRun && requestsDeactivation && deactivationReady,
      });
      if (result.error) {
        setStatus(toMessage(result.error));
        return;
      }
      const diff = result.data?.diff;
      if (!diff) return;
      const changes =
        diff.creates.makes +
        diff.creates.models +
        diff.creates.aliases +
        diff.updates.makes +
        diff.updates.models +
        diff.updates.aliases +
        diff.deactivates.makes +
        diff.deactivates.models +
        diff.deactivates.aliases;
      if (dryRun) {
        setDryRunJson(importJson);
        setConfirmDeactivation(false);
      }
      completed(
        dryRun
          ? `Dry run complete: ${changes} change${changes === 1 ? "" : "s"} detected.`
          : `Import complete: ${changes} change${changes === 1 ? "" : "s"} applied and audited.`,
      );
    });
  }

  function runExport() {
    setStatus(null);
    startExportTransition(async () => {
      const result = await exportVehicleCatalogue();
      if ("error" in result) {
        setStatus(
          typeof result.error === "string"
            ? result.error
            : "Catalogue export failed safely.",
        );
        return;
      }
      const blob = new Blob([JSON.stringify(result.data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "vehicle-catalogue.json";
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus("Catalogue export downloaded.");
    });
  }

  return (
    <>
      <section className="space-y-4 rounded-lg border border-border p-4">
        <h2 className="text-lg font-semibold text-text-primary">Find and add makes</h2>
        <form method="get" className="flex flex-col gap-2 sm:flex-row">
          <Input
            name="q"
            defaultValue={query}
            maxLength={80}
            placeholder="Search makes, models, or aliases"
            aria-label="Search vehicle catalogue"
            className="text-base sm:text-sm"
          />
          <Button type="submit">Search</Button>
        </form>
        <EntityEditor kind="make" onComplete={completed} />
      </section>

      <section className="space-y-3" aria-label="Vehicle catalogue records">
        {makes.length === 0 ? (
          <p className="rounded-lg border border-border p-4 text-sm text-text-secondary">
            No catalogue records match this search.
          </p>
        ) : null}
        {makes.map((make) => (
          <details
            key={make.id}
            className="rounded-lg border border-border bg-surface p-4"
          >
            <summary className="cursor-pointer text-base font-semibold text-text-primary">
              {make.name} · {make.active ? "Active" : "Inactive"} ·{" "}
              {make.models.length} model{make.models.length === 1 ? "" : "s"}
            </summary>
            <div className="mt-4 space-y-5">
              <p className="text-xs text-text-secondary">
                Source {make.source} · {make.sourceVersion} · imported{" "}
                {new Date(make.importedAt).toISOString()}
              </p>
              <EntityEditor kind="make" value={make} onComplete={completed} />
              <div className="space-y-3 border-t border-border pt-4">
                <h3 className="text-sm font-semibold text-text-primary">Models</h3>
                <EntityEditor
                  kind="model"
                  value={{ makeId: make.id }}
                  compact
                  onComplete={completed}
                />
                {make.models.map((model) => (
                  <details key={model.id} className="border-t border-border/70 pt-3">
                    <summary className="cursor-pointer text-sm font-medium text-text-primary">
                      {model.name} · {model.active ? "Active" : "Inactive"} ·{" "}
                      {model.aliases.length} alias{model.aliases.length === 1 ? "" : "es"}
                    </summary>
                    <div className="mt-3 space-y-3">
                      <p className="text-xs text-text-secondary">
                        Source {model.source} · {model.sourceVersion} · imported{" "}
                        {new Date(model.importedAt).toISOString()}
                      </p>
                      <EntityEditor
                        kind="model"
                        value={model}
                        compact
                        onComplete={completed}
                      />
                      <p className="text-xs text-text-secondary">
                        Aliases normalize lookup values to {model.name}.
                      </p>
                      <EntityEditor
                        kind="alias"
                        value={{ modelId: model.id }}
                        compact
                        onComplete={completed}
                      />
                      {model.aliases.map((alias) => (
                        <EntityEditor
                          key={alias.id}
                          kind="alias"
                          value={alias}
                          compact
                          onComplete={completed}
                        />
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          </details>
        ))}
      </section>

      <section className="space-y-4 rounded-lg border border-border p-4">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">JSON import / export</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Run a dry-run before applying. Applied imports are transactional and audited;
            missing records are only deactivated when the JSON opts in.
          </p>
        </div>
        <textarea
          value={importJson}
          onChange={(event) => {
            setImportJson(event.target.value);
            setDryRunJson(null);
            setConfirmDeactivation(false);
          }}
          maxLength={1_500_000}
          rows={10}
          aria-label="Vehicle catalogue import JSON"
          placeholder='{"source":"...","sourceVersion":"...","importedAt":"...","makes":[]}'
          className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-base text-text-primary focus:border-border-focus focus:outline-none focus:shadow-outline sm:text-sm"
        />
        {requestsDeactivation ? (
          <label className="flex items-start gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={confirmDeactivation}
              disabled={dryRunJson !== importJson}
              onChange={(event) =>
                setConfirmDeactivation(event.target.checked)
              }
              className="mt-0.5 h-5 w-5"
            />
            <span>
              I reviewed the current dry-run and confirm that missing records
              owned by this source may be deactivated.
            </span>
          </label>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={!importJson.trim() || isImportPending}
            loading={isImportPending}
            onClick={() => runImport(true)}
          >
            Dry-run diff
          </Button>
          <Button
            type="button"
            disabled={
              !importJson.trim() || isImportPending || !deactivationReady
            }
            loading={isImportPending}
            onClick={() => runImport(false)}
          >
            Apply transactional import
          </Button>
          <Button
            type="button"
            variant="ghost"
            loading={isExportPending}
            onClick={runExport}
          >
            Export JSON
          </Button>
        </div>
      </section>

      <p aria-live="polite" className="text-sm text-text-secondary">
        {status}
      </p>
    </>
  );
}
