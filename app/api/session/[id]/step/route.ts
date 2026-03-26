// app/api/session/[id]/step/route.ts

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEPRECATION_MESSAGE =
  "Deprecated endpoint. Use POST /api/session/[id]/answer for the Bilan de Santé protocol engine.";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: DEPRECATION_MESSAGE,
    },
    { status: 410 }
  );
}

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error: DEPRECATION_MESSAGE,
    },
    { status: 410 }
  );
}