import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabaseServer";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { sessionId, answer } = await req.json();

    if (!sessionId) {
      return NextResponse.json(
        { ok: false, error: "Missing sessionId" },
        { status: 400 }
      );
    }

    const admin = adminSupabase();

    const { data: session } = await admin
      .from("diagnostic_sessions")
      .select("dimension")
      .eq("id", sessionId)
      .maybeSingle();

    if (!session) {
      return NextResponse.json(
        { ok: false, error: "Session not found" },
        { status: 404 }
      );
    }

    const currentDimension = Number(session.dimension ?? 1);

    // si validation
    if (answer.toLowerCase().includes("oui")) {
      const nextDimension = currentDimension + 1;

      await admin
        .from("diagnostic_sessions")
        .update({
          dimension: nextDimension,
          iteration: 1,
        })
        .eq("id", sessionId);

      return NextResponse.json({
        ok: true,
        next_dimension: nextDimension,
      });
    }

    // sinon continuer dimension actuelle
    await admin
      .from("diagnostic_sessions")
      .update({
        iteration: 1,
      })
      .eq("id", sessionId);

    return NextResponse.json({
      ok: true,
      continue_dimension: currentDimension,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message },
      { status: 500 }
    );
  }
}