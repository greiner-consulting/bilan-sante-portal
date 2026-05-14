import { NextResponse } from "next/server";
import {
  adminSupabase,
  createSupabaseServerClient,
} from "@/lib/supabaseServer";
import { uploadDiagnosticSourceDocx } from "@/lib/diagnostic/storage";
import { extractTextFromDocx } from "@/lib/diagnostic/docx";
import { runDiagnosticEngine } from "@/lib/diagnostic/diagnosticEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOG_PREFIX = "[Diagnostic][StartRoute]";

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

function logWarn(event: string, payload?: Record<string, unknown>) {
  console.warn(`${LOG_PREFIX} ${event}`, payload ?? {});
}

function logError(event: string, payload?: Record<string, unknown>) {
  console.error(`${LOG_PREFIX} ${event}`, payload ?? {});
}

function summarizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? "unknown_error");
}

function getCookieNames(request: Request): string[] {
  const raw = request.headers.get("cookie") ?? "";
  if (!raw.trim()) return [];

  return raw
    .split(";")
    .map((part) => part.trim())
    .map((part) => part.split("=")[0]?.trim() ?? "")
    .filter(Boolean);
}

function getSupabaseCookieNames(request: Request): string[] {
  return getCookieNames(request).filter((name) => name.startsWith("sb-"));
}

async function clearDiagnosticEvents(sessionId: string) {
  const admin = adminSupabase();

  const { error } = await admin
    .from("diagnostic_events")
    .delete()
    .eq("session_id", sessionId);

  if (error) {
    logWarn("clear_events_failed", {
      sessionId,
      error: error.message,
    });
  }
}

export async function POST(req: Request) {
  const requestUrl = new URL(req.url);
  const cookieNames = getCookieNames(req);
  const supabaseCookieNames = getSupabaseCookieNames(req);

  logInfo("request_received", {
    method: req.method,
    origin: req.headers.get("origin") ?? null,
    referer: req.headers.get("referer") ?? null,
    host: req.headers.get("host") ?? null,
    requestUrl: requestUrl.toString(),
    hasCookieHeader: cookieNames.length > 0,
    cookieCount: cookieNames.length,
    supabaseCookieCount: supabaseCookieNames.length,
    supabaseCookieNames,
    hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
    supabaseUrlHost: process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host
      : null,
  });

  const supabaseSSR = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabaseSSR.auth.getUser();

  logInfo("auth_check", {
    hasUser: Boolean(user),
    userId: user?.id ?? null,
    authError: authError?.message ?? null,
    supabaseCookieCount: supabaseCookieNames.length,
  });

  if (!user) {
    logWarn("auth_missing_user", {
      reason:
        authError?.message ??
        (supabaseCookieNames.length === 0
          ? "NO_SUPABASE_COOKIE_ON_REQUEST"
          : "SUPABASE_SESSION_NOT_RESOLVED"),
      supabaseCookieNames,
    });

    return json(
      {
        ok: false,
        error: "Unauthorized",
        debug:
          process.env.NODE_ENV !== "production"
            ? {
                hasCookieHeader: cookieNames.length > 0,
                cookieCount: cookieNames.length,
                supabaseCookieCount: supabaseCookieNames.length,
                supabaseCookieNames,
                authError: authError?.message ?? null,
              }
            : undefined,
      },
      401
    );
  }

  const admin = adminSupabase();

  const { data: ent, error: entErr } = await admin
    .from("entitlements")
    .select("is_active, expires_at")
    .eq("user_id", user.id)
    .maybeSingle();

  logInfo("entitlement_check", {
    userId: user.id,
    hasEntitlementRow: Boolean(ent),
    isActive: Boolean(ent?.is_active),
    expiresAt: ent?.expires_at ?? null,
    entitlementError: entErr?.message ?? null,
  });

  if (entErr) {
    return json({ ok: false, error: entErr.message }, 500);
  }

  if (!ent?.is_active) {
    return json({ ok: false, error: "No entitlement" }, 403);
  }

  if (ent.expires_at && new Date(ent.expires_at).getTime() < Date.now()) {
    return json({ ok: false, error: "Access expired" }, 403);
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
    const now = new Date().toISOString();

    await clearDiagnosticEvents(sessionId);

    const { error: updErr } = await admin
      .from("diagnostic_sessions")
      .update({
        status: "in_progress",
        phase: "dimension_questions",
        dimension: 1,
        iteration: 1,
        question_index: 0,

        source_doc_path: docPath,
        source_filename: filename,
        source_mime: mime,
        source_size_bytes: file.size,
        extracted_text: extractedText,

        question_batch_json: [],
        coverage_json: {},
        global_analysis_json: {},
        diagnostic_result_json: {},
        final_objectives_json: {},
        consolidation_json: [],

        updated_at: now,
      })
      .eq("id", sessionId);

    if (updErr) {
      throw new Error(updErr.message);
    }

    logInfo("diagnostic_bootstrap_start", {
      sessionId,
      userId: user.id,
      hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
      extractedTextChars: extractedText.length,
      sourceFilename: filename,
      phase: "dimension_questions",
      dimension: 1,
      iteration: 1,
    });

    const assistant = await runDiagnosticEngine(sessionId, user.id, "");

    logInfo("diagnostic_bootstrap_completed", {
      sessionId,
      phase: "dimension_questions",
      questionCount: assistant.questions.length,
      needsValidation: assistant.needs_validation,
    });

    return json(
      {
        ok: true,
        session_id: sessionId,
        phase: "dimension_questions",
        ui_phase: "dimension_iteration",
        assistant_message: assistant.assistant_message,
        questions: assistant.questions,
        needs_validation: assistant.needs_validation,
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

    logError("diagnostic_bootstrap_failed", {
      sessionId,
      userId: user.id,
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