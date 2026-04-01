import { NextResponse } from "next/server";
import {
  adminSupabase,
  createSupabaseServerClient,
} from "@/lib/supabaseServer";
import { uploadDiagnosticSourceDocx } from "@/lib/diagnostic/storage";
import { extractTextFromDocx } from "@/lib/diagnostic/docx";
import { bootstrapSessionFromTrameWithLlm } from "@/lib/bilan-sante/protocol-engine";
import { saveAggregate } from "@/lib/bilan-sante/session-repository";
import {
  entitlementIsUsable,
  getActiveEntitlementForUser,
  isAdminUser,
} from "@/lib/auth/access-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOG_PREFIX = "[BilanSante][StartRoute]";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function logInfo(event: string, payload?: Record<string, unknown>) {
  console.info(`${LOG_PREFIX} ${event}`, payload ?? {});
}

function logError(event: string, payload?: Record<string, unknown>) {
  console.error(`${LOG_PREFIX} ${event}`, payload ?? {});
}

function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error ?? "unknown_error");
}

export async function POST(req: Request) {
  const supabaseSSR = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabaseSSR.auth.getUser();

  if (!user) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const admin = adminSupabase();

  const adminFlag = await isAdminUser(user.id);

  if (!adminFlag) {
    const ent = await getActiveEntitlementForUser(user.id);

    if (!entitlementIsUsable(ent)) {
      return json({ ok: false, error: "No entitlement" }, 403);
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

  if (String(session.user_id ?? "") !== user.id) {
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

    logInfo("bootstrap_start", {
      sessionId,
      hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
      extractedTextChars: extractedText.length,
      sourceFilename: filename,
    });

    const aggregate = await bootstrapSessionFromTrameWithLlm({
      sessionId,
      rawTrameText: extractedText,
    });

    await saveAggregate(sessionId, aggregate);

    logInfo("bootstrap_completed", {
      sessionId,
      phase: aggregate.phase,
      currentDimensionId: aggregate.currentDimensionId,
      currentIteration: aggregate.currentIteration,
      totalSignals: aggregate.signalRegistry?.allSignals.length ?? 0,
      firstWorksetQuestions: aggregate.currentWorkset?.questions.length ?? 0,
    });

    return json(
      {
        ok: true,
        session_id: sessionId,
        phase: aggregate.phase,
      },
      200
    );
  } catch (error) {
    await admin
      .from("diagnostic_sessions")
      .update({
        status: "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);

    logError("bootstrap_failed", {
      sessionId,
      error: summarizeError(error),
      hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
    });

    return json(
      {
        ok: false,
        error: summarizeError(error) || "Ingestion failed",
        session_id: sessionId,
      },
      500
    );
  }
}

export async function GET() {
  return json({ ok: false, error: "Method Not Allowed" }, 405);
}