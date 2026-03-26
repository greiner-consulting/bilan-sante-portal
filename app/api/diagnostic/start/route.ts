import { NextResponse } from "next/server";
import {
  adminSupabase,
  createSupabaseServerClient,
} from "@/lib/supabaseServer";
import { uploadDiagnosticSourceDocx } from "@/lib/diagnostic/storage";
import { extractTextFromDocx } from "@/lib/diagnostic/docx";
import { bootstrapSessionFromTrame } from "@/lib/bilan-sante/protocol-engine";
import { saveAggregate } from "@/lib/bilan-sante/session-repository";

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

function isBypass() {
  return (
    process.env.DEV_BYPASS_AUTH === "1" ||
    process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "1"
  );
}

async function getEffectiveUserId(): Promise<string> {
  if (isBypass()) {
    const id = process.env.DEV_BYPASS_USER_ID;
    if (!id) {
      throw new Error("Missing DEV_BYPASS_USER_ID");
    }
    return id;
  }

  const supabaseSSR = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabaseSSR.auth.getUser();

  if (!user) {
    throw new Error("UNAUTHENTICATED");
  }

  return user.id;
}

export async function POST(req: Request) {
  let effectiveUserId: string;

  try {
    effectiveUserId = await getEffectiveUserId();
  } catch (e: any) {
    const msg = e?.message ?? "Unauthorized";
    return json(
      { ok: false, error: msg },
      msg === "UNAUTHENTICATED" ? 401 : 500
    );
  }

  const admin = adminSupabase();

  if (!isBypass()) {
    const { data: ent, error: entErr } = await admin
      .from("entitlements")
      .select("is_active, expires_at")
      .eq("user_id", effectiveUserId)
      .maybeSingle();

    if (entErr) {
      return json({ ok: false, error: entErr.message }, 500);
    }

    if (!ent?.is_active) {
      return json({ ok: false, error: "No entitlement" }, 403);
    }

    if (ent.expires_at && new Date(ent.expires_at).getTime() < Date.now()) {
      return json({ ok: false, error: "Access expired" }, 403);
    }
  }

  const form = await req.formData();
  const file = form.get("file");
  const sessionId = String(form.get("session_id") ?? "").trim();

  if (!sessionId) {
    return json({ ok: false, error: "Missing session_id" }, 400);
  }

  if (!file || !(file instanceof File)) {
    return json({ ok: false, error: "Missing file (field name: file)" }, 400);
  }

  const { data: session, error: sessionErr } = await admin
    .from("diagnostic_sessions")
    .select("id, user_id, status, phase")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionErr) {
    return json({ ok: false, error: sessionErr.message }, 500);
  }

  if (!session) {
    return json({ ok: false, error: "Session not found" }, 404);
  }

  if (!isBypass() && String(session.user_id ?? "") !== effectiveUserId) {
    return json({ ok: false, error: "Forbidden" }, 403);
  }

  const filename = file.name || "trame.docx";
  const mime =
    file.type ||
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  const maxBytes = 8 * 1024 * 1024;

  if (file.size <= 0) {
    return json({ ok: false, error: "Empty file" }, 400);
  }

  if (file.size > maxBytes) {
    return json({ ok: false, error: "File too large (max 8MB)" }, 413);
  }

  if (!filename.toLowerCase().endsWith(".docx")) {
    return json({ ok: false, error: "Only .docx is supported" }, 400);
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);

    const docPath = await uploadDiagnosticSourceDocx({
      sessionId,
      filename,
      bytes,
      mime,
    });

    const extractedText = await extractTextFromDocx(bytes);

    const { error: updErr } = await admin
      .from("diagnostic_sessions")
      .update({
        status: "collected",
        phase: "awaiting_trame",
        source_doc_path: docPath,
        source_filename: filename,
        source_mime: mime,
        source_size_bytes: file.size,
        extracted_text: extractedText,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);

    if (updErr) {
      throw new Error(updErr.message);
    }

    const aggregate = await bootstrapSessionFromTrame({
      sessionId,
      rawTrameText: extractedText,
    });

    await saveAggregate(sessionId, aggregate);

    return json(
      {
        ok: true,
        session_id: sessionId,
        phase: aggregate.phase,
      },
      200
    );
  } catch (e: any) {
    await admin
      .from("diagnostic_sessions")
      .update({
        status: "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);

    return json(
      {
        ok: false,
        error: e?.message ?? "Ingestion failed",
        session_id: sessionId,
      },
      500
    );
  }
}

export async function GET() {
  return json({ ok: false, error: "Method Not Allowed" }, 405);
}