// app/api/reports/[id]/docx/ping/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    ping: "REPORTS DOCX PING OK",
    route: "/api/reports/[id]/docx/ping",
  });
}