import { NextResponse } from "next/server";
import { scoreDimension } from "@/lib/diagnostic/scoreDimension";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { sessionId } = await req.json();

    if (!sessionId) {
      return NextResponse.json(
        { ok: false, error: "Missing sessionId" },
        { status: 400 }
      );
    }

    const results = [];

    for (let d = 1; d <= 4; d++) {
      const score = await scoreDimension(sessionId, d);
      results.push(score);
    }

    return NextResponse.json({
      ok: true,
      diagnostic: results,
    });

  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message },
      { status: 500 }
    );
  }
}