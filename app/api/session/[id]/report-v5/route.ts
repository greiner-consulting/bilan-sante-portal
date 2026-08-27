import { NextResponse } from "next/server";
import { adminSupabase, createSupabaseServerClient } from "@/lib/supabaseServer";
import { uploadReportDocx, createSignedReportUrl } from "@/lib/report/storage";
import { buildReportV5, type ReportIdentification } from "@/lib/report/reportV5LLM";
import { buildReportV5Docx } from "@/lib/report/buildReportV5Docx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCHEMA_VERSION = "dialogue_v5_report_1";

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

async function getEffectiveUserId() {
  if (isBypass()) {
    const id = process.env.DEV_BYPASS_USER_ID;
    if (!id) throw new Error("Missing DEV_BYPASS_USER_ID");
    return id;
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return user.id;
}

function clean(value: unknown, max = 180) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeIdentification(raw: any): ReportIdentification {
  const identification: ReportIdentification = {
    entreprise: clean(raw?.entreprise),
    dirigeant: clean(raw?.dirigeant),
    activite: clean(raw?.activite),
    localisation: clean(raw?.localisation),
    date: clean(raw?.date) || new Intl.DateTimeFormat("fr-FR").format(new Date()),
  };

  if (
    !identification.entreprise ||
    !identification.dirigeant ||
    !identification.activite ||
    !identification.localisation
  ) {
    throw new Error("REPORT_IDENTIFICATION_INCOMPLETE");
  }
  return identification;
}

async function loadOwnedSession(sessionId: string, userId: string) {
  const admin = adminSupabase();
  const { data, error } = await admin
    .from("diagnostic_sessions")
    .select("id,user_id,status,phase,coverage_json,final_objectives_json,created_at,updated_at")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Session not found");
  if (!isBypass() && String(data.user_id ?? "") !== userId) throw new Error("FORBIDDEN");
  return data;
}

function frozenDiagnosticState(row: any) {
  const coverage =
    row?.coverage_json && typeof row.coverage_json === "object" && !Array.isArray(row.coverage_json)
      ? row.coverage_json
      : {};
  const state = (coverage as Record<string, any>).dialogue_v5;
  if (!state || state.version !== 5) throw new Error("V5_DIAGNOSTIC_NOT_FOUND");

  const areas = ["context", "rh", "commercial", "pricing", "execution"];
  const materials = state.materials || {};
  if (areas.some((area) => !materials?.[area]?.validated)) {
    throw new Error("REPORT_REQUIRES_ALL_VALIDATED_DOMAINS");
  }
  if (!state?.objectives?.validated || !state?.objectives?.proposal) {
    throw new Error("REPORT_REQUIRES_VALIDATED_OBJECTIVES");
  }
  if (state.stage !== "complete") {
    throw new Error("REPORT_DIAGNOSTIC_NOT_COMPLETE");
  }

  return {
    version: 5,
    context: {
      structured_data: materials.context?.structured_data ?? null,
      narrative_answer: materials.context?.narrative_answer ?? "",
      qa: materials.context?.qa ?? [],
      analyses: materials.context?.analyses ?? {},
      final_analysis: materials.context?.final_analysis ?? null,
      final_synthesis: materials.context?.final_synthesis ?? "",
      swot: materials.context?.swot ?? null,
    },
    dimensions: {
      rh: materials.rh,
      commercial: materials.commercial,
      pricing: materials.pricing,
      execution: materials.execution,
    },
    objectives: state.objectives,
  };
}

async function latestReport(userId: string, sessionId: string) {
  const admin = adminSupabase();
  const { data, error } = await admin
    .from("reports")
    .select("id,status,docx_path,error,created_at,updated_at,input")
    .eq("user_id", userId)
    .eq("schema_version", SCHEMA_VERSION)
    .contains("input", { session_id: sessionId })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data ?? null;
}

async function reportDownloadUrl(report: any) {
  if (report?.status !== "ready" || !report?.docx_path) return null;
  return createSignedReportUrl({ docxPath: report.docx_path, expiresInSeconds: 60 * 10 });
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await context.params;
    const userId = await getEffectiveUserId();
    const row = await loadOwnedSession(sessionId, userId);

    let readyForReport = false;
    let reason: string | null = null;
    try {
      frozenDiagnosticState(row);
      readyForReport = true;
    } catch (e: any) {
      reason = e?.message ?? "REPORT_NOT_READY";
    }

    const report = await latestReport(userId, sessionId);
    const downloadUrl = await reportDownloadUrl(report);

    return json({
      ok: true,
      ready_for_report: readyForReport,
      reason,
      latest_report: report
        ? {
            id: report.id,
            status: report.status,
            error: report.error ?? null,
            created_at: report.created_at ?? null,
            updated_at: report.updated_at ?? null,
            download_url: downloadUrl,
            identification: report.input?.identification ?? null,
          }
        : null,
      identification_defaults: {
        date: new Intl.DateTimeFormat("fr-FR").format(new Date()),
      },
    });
  } catch (error: any) {
    const message = error?.message ?? "Report status error";
    const status =
      message === "UNAUTHENTICATED"
        ? 401
        : message === "FORBIDDEN"
        ? 403
        : message === "Session not found"
        ? 404
        : 500;
    return json({ ok: false, error: message }, status);
  }
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  let reportId: string | null = null;
  try {
    const { id: sessionId } = await context.params;
    const userId = await getEffectiveUserId();
    const body = await req.json().catch(() => ({}));
    const identification = normalizeIdentification(body?.identification);
    const row = await loadOwnedSession(sessionId, userId);
    const frozenState = frozenDiagnosticState(row);
    const admin = adminSupabase();

    const { data: created, error: createError } = await admin
      .from("reports")
      .insert({
        user_id: userId,
        status: "generating",
        schema_version: SCHEMA_VERSION,
        input: { session_id: sessionId, identification },
      })
      .select("id")
      .single();

    if (createError || !created?.id) {
      throw new Error(createError?.message ?? "REPORT_ROW_CREATE_FAILED");
    }
    reportId = String(created.id);

    const reportJson = await buildReportV5({
      identification,
      diagnosticState: frozenState,
    });
    const bytes = buildReportV5Docx(reportJson);
    const docxPath = await uploadReportDocx({ reportId, bytes });

    const { error: updateError } = await admin
      .from("reports")
      .update({
        status: "ready",
        report_json: reportJson,
        docx_path: docxPath,
        error: null,
      })
      .eq("id", reportId);
    if (updateError) throw new Error(updateError.message);

    const downloadUrl = await createSignedReportUrl({
      docxPath,
      expiresInSeconds: 60 * 10,
    });

    return json({
      ok: true,
      report_id: reportId,
      status: "ready",
      download_url: downloadUrl,
    });
  } catch (error: any) {
    const message = error?.message ?? "Report generation failed";
    if (reportId) {
      try {
        await adminSupabase()
          .from("reports")
          .update({ status: "failed", error: message })
          .eq("id", reportId);
      } catch {
        // Preserve the original generation error.
      }
    }

    const status =
      message === "UNAUTHENTICATED"
        ? 401
        : message === "FORBIDDEN"
        ? 403
        : message === "Session not found"
        ? 404
        : message === "REPORT_IDENTIFICATION_INCOMPLETE"
        ? 400
        : message.startsWith("REPORT_REQUIRES") ||
          message === "REPORT_DIAGNOSTIC_NOT_COMPLETE" ||
          message === "V5_DIAGNOSTIC_NOT_FOUND"
        ? 409
        : 500;

    return json({ ok: false, error: message, report_id: reportId }, status);
  }
}
