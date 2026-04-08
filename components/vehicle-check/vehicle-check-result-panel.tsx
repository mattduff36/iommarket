import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type {
  VehicleCheckResult,
  VehicleMileageSummary,
  VehicleMotTest,
} from "@/lib/services/vehicle-check-types";
import {
  AlertTriangle,
  CalendarDays,
  Download,
  ExternalLink,
  Fuel,
  Gauge,
  History,
  ShieldCheck,
} from "lucide-react";

function formatDate(value: string | null | undefined): string {
  if (!value) return "Unavailable";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Unavailable";

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatEngineSize(engineSizeCc: number | null | undefined): string {
  if (!engineSizeCc) return "Unavailable";
  if (engineSizeCc < 1000) return `${engineSizeCc}cc`;
  return `${(engineSizeCc / 1000).toFixed(1)}L (${engineSizeCc}cc)`;
}

function getStatusVariant(
  value: string | null | undefined
): "success" | "warning" | "error" | "info" | "neutral" {
  if (!value) return "neutral";

  const normalized = value.toLowerCase();
  if (
    normalized.includes("taxed") ||
    normalized.includes("valid") ||
    normalized.includes("active")
  ) {
    return "success";
  }
  if (normalized.includes("sorn")) return "warning";
  if (
    normalized.includes("untaxed") ||
    normalized.includes("not valid") ||
    normalized.includes("expired")
  ) {
    return "error";
  }

  return "info";
}

function getDefectVariant(
  type: string,
  dangerous: boolean
): "error" | "warning" | "info" | "neutral" {
  if (dangerous) return "error";
  if (type === "DANGEROUS" || type === "MAJOR" || type === "FAIL") return "error";
  if (type === "MINOR") return "warning";
  if (type === "PRS") return "info";
  return "neutral";
}

function MetricCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: "blue" | "red" | "gold" | "emerald";
}) {
  const accentClass = {
    blue: "border-neon-blue-500/30 bg-neon-blue-500/6",
    red: "border-neon-red-500/30 bg-neon-red-500/6",
    gold: "border-premium-gold-500/25 bg-premium-gold-500/6",
    emerald: "border-emerald-500/25 bg-emerald-500/6",
  }[accent];

  return (
    <div className={`rounded-xl border p-4 ${accentClass}`}>
      <p className="text-[11px] uppercase tracking-[0.18em] text-metallic-400">
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold text-text-primary">{value}</p>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 py-3 text-sm last:border-b-0">
      <span className="text-metallic-400">{label}</span>
      <span className="text-right font-medium text-text-primary">{value}</span>
    </div>
  );
}

function MileageChart({ mileage }: { mileage: VehicleMileageSummary }) {
  if (mileage.points.length < 2) {
    return (
      <EmptyState
        icon={<Gauge className="h-6 w-6" />}
        title="Not enough mileage points yet"
        description="Mileage charts appear once there are at least two passed MOT readings."
        className="py-10"
      />
    );
  }

  const width = 640;
  const height = 240;
  const padding = 24;
  const values = mileage.points.map((point) => point.mileage);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valueRange = Math.max(maxValue - minValue, 1);
  const stepX = (width - padding * 2) / Math.max(mileage.points.length - 1, 1);

  const points = mileage.points
    .map((point, index) => {
      const x = padding + index * stepX;
      const normalizedY = (point.mileage - minValue) / valueRange;
      const y = height - padding - normalizedY * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="space-y-4">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full rounded-xl border border-neon-blue-500/20 bg-canvas/70"
        role="img"
        aria-label="Mileage history chart"
      >
        <defs>
          <linearGradient id="mileage-line" x1="0%" x2="100%" y1="0%" y2="0%">
            <stop offset="0%" stopColor="#33B5FF" />
            <stop offset="100%" stopColor="#FF3B5C" />
          </linearGradient>
        </defs>
        <polyline
          fill="none"
          stroke="url(#mileage-line)"
          strokeWidth="4"
          points={points}
        />
        {mileage.points.map((point, index) => {
          const x = padding + index * stepX;
          const normalizedY = (point.mileage - minValue) / valueRange;
          const y = height - padding - normalizedY * (height - padding * 2);
          return (
            <circle
              key={`${point.date}-${point.mileage}`}
              cx={x}
              cy={y}
              r="5"
              fill="#33B5FF"
              stroke="#0B1015"
              strokeWidth="2"
            />
          );
        })}
      </svg>
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          label="Latest reading"
          value={
            mileage.latestMileage !== null
              ? `${mileage.latestMileage.toLocaleString()} miles`
              : "Unavailable"
          }
          accent="blue"
        />
        <MetricCard
          label="First recorded"
          value={
            mileage.earliestMileage !== null
              ? `${mileage.earliestMileage.toLocaleString()} miles`
              : "Unavailable"
          }
          accent="gold"
        />
        <MetricCard
          label="Average annual"
          value={
            mileage.averageAnnualMileage !== null
              ? `${mileage.averageAnnualMileage.toLocaleString()} miles`
              : "Unavailable"
          }
          accent="emerald"
        />
      </div>
    </div>
  );
}

function MotHistoryList({ tests }: { tests: VehicleMotTest[] }) {
  if (tests.length === 0) {
    return (
      <EmptyState
        icon={<History className="h-6 w-6" />}
        title="No MOT tests on record"
        description="This can happen when the vehicle is still too new for its first MOT or the linked source has no records yet."
        className="py-10"
      />
    );
  }

  return (
    <div className="space-y-4">
      {tests.map((test) => (
        <div
          key={`${test.completedDate}-${test.motTestNumber ?? test.testResult}`}
          className="rounded-xl border border-border bg-canvas/50 p-4"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={getStatusVariant(test.testResult)}>
                  {test.testResult}
                </Badge>
                <span className="text-sm font-medium text-text-primary">
                  {formatDate(test.completedDate)}
                </span>
              </div>
              <p className="mt-2 text-sm text-text-secondary">
                {test.odometerValue !== null
                  ? `${test.odometerValue.toLocaleString()} ${test.odometerUnit ?? "mi"}`
                  : "Mileage unavailable"}
                {test.expiryDate ? ` · Expires ${formatDate(test.expiryDate)}` : ""}
              </p>
            </div>
            {test.motTestNumber ? (
              <p className="text-xs uppercase tracking-[0.16em] text-metallic-500">
                Test no. {test.motTestNumber}
              </p>
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {test.defects.length > 0 ? (
              test.defects.map((defect, index) => (
                <div
                  key={`${defect.text}-${index}`}
                  className="rounded-lg border border-border/70 bg-surface/80 px-3 py-2 text-sm"
                >
                  <div className="mb-1">
                    <Badge variant={getDefectVariant(defect.type, defect.dangerous)}>
                      {defect.dangerous ? "Dangerous" : defect.type}
                    </Badge>
                  </div>
                  <p className="text-text-secondary">{defect.text}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-text-secondary">
                No advisories or defects recorded.
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function VehicleCheckResultPanel({
  result,
  onExportPdf,
}: {
  result: VehicleCheckResult;
  onExportPdf: () => void;
}) {
  const vehicle = result.vehicle;

  if (!vehicle) {
    return null;
  }

  const heading = [vehicle.make, vehicle.model].filter(Boolean).join(" ");

  return (
    <div className="space-y-6">
      {result.warnings.length > 0 ? (
        <Card className="border-premium-gold-500/30 bg-premium-gold-500/8">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-premium-gold-400" />
              <div className="space-y-2">
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-premium-gold-400">
                  Live lookup notes
                </p>
                <ul className="space-y-1 text-sm text-text-secondary">
                  {result.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="overflow-hidden border-neon-blue-500/30 bg-[radial-gradient(circle_at_top_left,rgba(51,181,255,0.16),transparent_42%),linear-gradient(135deg,rgba(10,13,18,0.96),rgba(14,17,22,0.94))]">
        <CardContent className="p-0">
          <div className="grid gap-0 lg:grid-cols-[1.35fr_0.65fr]">
            <div className="border-b border-border/60 p-6 lg:border-r lg:border-b-0 lg:p-8">
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant={result.isManx ? "energy" : "trust"}>
                  {result.isManx ? "Isle of Man" : "UK"}
                </Badge>
                <Badge variant="neutral">{vehicle.lookupPath.toUpperCase()} lookup</Badge>
                {vehicle.previousUkRegistration ? (
                  <Badge variant="info">
                    Previous UK reg {vehicle.previousUkRegistration}
                  </Badge>
                ) : null}
              </div>

              <div className="mt-5">
                <p className="text-xs uppercase tracking-[0.24em] text-metallic-400">
                  Vehicle dossier
                </p>
                <h2 className="mt-2 text-3xl font-bold text-text-primary sm:text-4xl">
                  {result.displayRegistration}
                </h2>
                <p className="mt-3 max-w-2xl text-base text-metallic-300 sm:text-lg">
                  {heading || "Vehicle details found"}
                </p>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                  label="Tax status"
                  value={vehicle.taxStatus ?? "Unavailable"}
                  accent="blue"
                />
                <MetricCard
                  label="MOT status"
                  value={vehicle.motStatus ?? "Unavailable"}
                  accent="red"
                />
                <MetricCard
                  label="Tax due"
                  value={formatDate(vehicle.taxDueDate)}
                  accent="gold"
                />
                <MetricCard
                  label="MOT due"
                  value={formatDate(vehicle.motExpiryDate)}
                  accent="emerald"
                />
              </div>
            </div>

            <div className="flex flex-col justify-between p-6 lg:p-8">
              <div className="space-y-4">
                <div className="rounded-xl border border-white/10 bg-white/4 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-metallic-400">
                    Checked
                  </p>
                  <p className="mt-2 text-sm text-text-primary">
                    {formatDate(result.checkedAt)}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/4 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-metallic-400">
                    Source path
                  </p>
                  <p className="mt-2 text-sm text-text-primary">
                    {result.sourceNotes.map((note) => note.label).join(" · ")}
                  </p>
                </div>
              </div>

              <Button
                type="button"
                variant="trust"
                size="lg"
                className="mt-6 w-full"
                leftIcon={<Download className="h-4 w-4" />}
                onClick={onExportPdf}
              >
                Export PDF-style report
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader>
            <CardTitle>Vehicle details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-0">
              <DetailRow label="Make" value={vehicle.make ?? "Unavailable"} />
              <DetailRow label="Model" value={vehicle.model ?? "Unavailable"} />
              <DetailRow label="Colour" value={vehicle.colour ?? "Unavailable"} />
              <DetailRow label="Fuel type" value={vehicle.fuelType ?? "Unavailable"} />
              <DetailRow label="Engine" value={formatEngineSize(vehicle.engineSizeCc)} />
              <DetailRow
                label="Year of manufacture"
                value={vehicle.yearOfManufacture?.toString() ?? "Unavailable"}
              />
              <DetailRow
                label="CO2 emissions"
                value={
                  vehicle.co2Emissions !== null && vehicle.co2Emissions !== undefined
                    ? `${vehicle.co2Emissions} g/km`
                    : "Unavailable"
                }
              />
              <DetailRow
                label="First registration"
                value={formatDate(vehicle.monthOfFirstRegistration)}
              />
              {vehicle.roadTax12Month ? (
                <DetailRow label="IoM annual duty" value={vehicle.roadTax12Month} />
              ) : null}
              {vehicle.roadTax6Month ? (
                <DetailRow label="IoM 6-month duty" value={vehicle.roadTax6Month} />
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick read</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-canvas/40 p-4">
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                  <ShieldCheck className="h-4 w-4 text-neon-blue-400" />
                  Tax position
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Badge variant={getStatusVariant(vehicle.taxStatus)}>
                    {vehicle.taxStatus ?? "Unavailable"}
                  </Badge>
                  <span className="text-sm text-metallic-400">
                    Due {formatDate(vehicle.taxDueDate)}
                  </span>
                </div>
              </div>
              <div className="rounded-xl border border-border bg-canvas/40 p-4">
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                  <CalendarDays className="h-4 w-4 text-neon-red-400" />
                  MOT position
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Badge variant={getStatusVariant(vehicle.motStatus)}>
                    {vehicle.motStatus ?? "Unavailable"}
                  </Badge>
                  <span className="text-sm text-metallic-400">
                    Due {formatDate(vehicle.motExpiryDate)}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-canvas/40 p-4">
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                  <Fuel className="h-4 w-4 text-neon-blue-400" />
                  Fuel and emissions
                </div>
                <p className="mt-3 text-sm text-text-primary">
                  {vehicle.fuelType ?? "Fuel type unavailable"}
                  {vehicle.co2Emissions !== null && vehicle.co2Emissions !== undefined
                    ? ` · ${vehicle.co2Emissions} g/km`
                    : ""}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-canvas/40 p-4">
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                  <Gauge className="h-4 w-4 text-premium-gold-400" />
                  Mileage headline
                </div>
                <p className="mt-3 text-sm text-text-primary">
                  {result.mileage?.latestMileage !== null &&
                  result.mileage?.latestMileage !== undefined
                    ? `${result.mileage.latestMileage.toLocaleString()} miles last recorded`
                    : "Mileage unavailable"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Mileage trend</CardTitle>
        </CardHeader>
        <CardContent>
          {result.mileage ? (
            <MileageChart mileage={result.mileage} />
          ) : (
            <EmptyState
              icon={<Gauge className="h-6 w-6" />}
              title="Mileage data unavailable"
              description="Mileage trends are built from passed MOT test readings."
              className="py-10"
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>MOT history</CardTitle>
        </CardHeader>
        <CardContent>
          {result.motHistory ? (
            <MotHistoryList tests={result.motHistory.motTests} />
          ) : (
            <EmptyState
              icon={<History className="h-6 w-6" />}
              title="No MOT history returned"
              description="Try again later, or check whether this vehicle is still too new for its first MOT."
              className="py-10"
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Auction references</CardTitle>
        </CardHeader>
        <CardContent>
          {result.auctionHistory ? (
            <div className="grid gap-4 md:grid-cols-2">
              {result.auctionHistory.entries.map((entry) => (
                <div
                  key={`${entry.lotUrl}-${entry.lotNumber ?? "lot"}`}
                  className="rounded-xl border border-border bg-canvas/45 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-metallic-500">
                        {entry.source}
                      </p>
                      <h3 className="mt-2 text-base font-semibold text-text-primary">
                        {entry.saleTitle}
                      </h3>
                    </div>
                    <Badge variant="neutral">Lot {entry.lotNumber ?? "N/A"}</Badge>
                  </div>
                  <p className="mt-3 text-sm text-text-secondary">
                    {entry.lotTitle}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-metallic-400">
                    <span>{formatDate(entry.saleDate)}</span>
                    <span>{formatCurrency(entry.hammerPrice)}</span>
                  </div>
                  <Link
                    href={entry.lotUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-text-trust hover:underline"
                  >
                    Open lot details <ExternalLink className="h-4 w-4" />
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<ExternalLink className="h-6 w-6" />}
              title="No auction references found"
              description="No live matches were found on the external auction source we checked."
              className="py-10"
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Source notes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            {result.sourceNotes.map((note) => (
              <div
                key={note.id}
                className="rounded-xl border border-border bg-canvas/40 p-4"
              >
                <p className="text-xs uppercase tracking-[0.18em] text-metallic-400">
                  {note.label}
                </p>
                <p className="mt-2 text-sm text-text-secondary">{note.detail}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
