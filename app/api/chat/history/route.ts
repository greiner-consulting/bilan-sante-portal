// app/api/chat/history/route.ts
import { NextResponse } from "next/server";
import { adminSupabase, createSupabaseServerClient } from "@/lib/supabaseServer";

export const runtime = "nodejs";

function isBypass() {
  return process.env.DEV_BYPASS_AUTH === "1" || process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "1";
}

async function getUserId(): Promise<string> {
  if (isBypass()) {
    const id = process.env.DEV_BYPASS_USER_ID;
    if (!id) throw new Error("Missing DEV_BYPASS_USER_ID");
    return id;
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return user.id;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get("sessionId");
    if (!sessionId) return NextResponse.json({ ok: false, error: "Missing sessionId" }, { status: 400 });

    const userId = await getUserId();
    const admin = adminSupabase();

    const { data: session } = await admin
      .from("diagnostic_sessions")
      .select("id,user_id")
      .eq("id", sessionId)
      .maybeSingle();

    if (!session) return NextResponse.json({ ok: false, error: "Session not found" }, { status: 404 });
    if (!isBypass() && session.user_id !== userId) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    const { data: events, error } = await admin
      .from("diagnostic_events")
      .select("kind,payload,created_at")
      .eq("session_id", sessionId)
      .in("kind", ["CHAT_USER", "CHAT_ASSISTANT"])
      .order("created_at", { ascending: true });

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const messages = (events ?? []).map((e: any) => {
      if (e.kind === "CHAT_USER") {
        return { role: "user" as const, text: String(e.payload?.text ?? ""), created_at: e.created_at };
      }
      const p = e.payload ?? {};
      return { role: "assistant" as const, text: String(p.assistant_message ?? ""), created_at: e.created_at, raw: p };
    });

    return NextResponse.json({ ok: true, messages });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const code = msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status: code });
  }
}