import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function POST() {
  return json(
    {
      ok: false,
      error: "LEGACY_ROUTE_DISABLED",
      message:
        "Cette route legacy est désactivée. Utiliser /api/diagnostic/start pour l’ingestion de trame DOCX.",
    },
    410
  );
}

export async function GET() {
  return json(
    {
      ok: false,
      error: "LEGACY_ROUTE_DISABLED",
      message:
        "Cette route legacy est désactivée. Utiliser /api/diagnostic/start pour l’ingestion de trame DOCX.",
    },
    410
  );
}