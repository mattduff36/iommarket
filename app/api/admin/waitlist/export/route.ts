import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { captureException } from "@/lib/monitoring";
import { acceptedAuthHttpStatus } from "@/lib/policy/gate";

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

function authFailureMessage(status: 401 | 403 | 500): string {
  if (status === 401) return "Authentication required";
  if (status === 403) return "Forbidden";
  return "Export failed";
}

export async function GET() {
  try {
    await requireRole("ADMIN");
  } catch (error) {
    const status = acceptedAuthHttpStatus(error);
    if (status === 500) {
      await captureException({
        source: "SERVER",
        error,
        action: "exportWaitlist",
        route: "/api/admin/waitlist/export",
        requestPath: "/api/admin/waitlist/export",
      });
    }
    return NextResponse.json({ error: authFailureMessage(status) }, { status });
  }

  try {
    const rows = await db.waitlistUser.findMany({
      where: { deletedAt: null },
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
  } catch (error) {
    await captureException({
      source: "SERVER",
      error,
      action: "exportWaitlist",
      route: "/api/admin/waitlist/export",
      requestPath: "/api/admin/waitlist/export",
    });
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
