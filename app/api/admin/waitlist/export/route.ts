import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";

function parseInterests(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function formatInterestLabel(interest: string): string {
  switch (interest) {
    case "BUYING_CARS":
      return "Buying cars";
    case "SELLING_CARS":
      return "Selling cars";
    case "DEALER":
      return "Dealer";
    default:
      return interest;
  }
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}

export async function GET() {
  await requireRole("ADMIN");

  const rows = await db.waitlistUser.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      email: true,
      interests: true,
      source: true,
      createdAt: true,
    },
  });

  const header = "email,interests,source,created_at";
  const lines = rows.map((row) => {
    const interests = parseInterests(row.interests).map(formatInterestLabel).join(" | ");
    return [
      csvEscape(row.email),
      csvEscape(interests),
      csvEscape(row.source),
      csvEscape(row.createdAt.toISOString()),
    ].join(",");
  });

  const csv = [header, ...lines].join("\n");
  const datePart = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="waitlist-${datePart}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
