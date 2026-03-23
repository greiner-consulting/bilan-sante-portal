// app/api/ping/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ✅ pas de export default en App Router API
export async function GET() {
  return NextResponse.json({ ok: true, ping: "root api ok" });
}