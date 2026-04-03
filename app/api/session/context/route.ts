
import { NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  adminSupabase,
} from "@/lib/supabaseServer";
import { loadAggregate, saveAggregate } from "@/lib/bilan-sante/session-repository";
import { bootstrapSessionFromTrameWithLlm } from "@/lib/bilan-sante/protocol-engine";
import type { DiagnosticSessionAggregate } from "@/lib/bilan-sante/session-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isBypass() {
  return (
    process.env.DEV_BYPASS_AUTH === "1" ||
    process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "1"
  );
}

async function getEffectiveUserId(): Promise<string> {
  if (isBypass()) {
    const id = process.env.DEV_BYPASS_USER_ID;
    if (!id) throw new Error("Missing DEV_BYPASS_USER_ID");
    return id;
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("UNAUTHENTICATED");
  }

  return user.id;
}

function mapSessionStatus(phase?: string | null, fallback?: string | null): string | undefined {
  if (!phase) return fallback ?? undefined;

  switch (phase) {
    case "awaiting_trame":
      return "collected";
    case "report_ready":
      return "report_ready";
    case "dimension_iteration":
    case "iteration_validation":
    case "final_objectives_validation":
      return "in_progress";
    case "completed":
      return "completed";
    default:
      return fallback ?? "in_progress";
  }
}

function aggregateNeedsRecovery(params: {
  row: {
    extracted_text: string | null;
    phase?: string | null;
  };
  aggregate: DiagnosticSessionAggregate | null;
}): boolean {
  if (!params.row.extracted_text) return false;
  if (!params.aggregate) return true;

  if (params.aggregate.phase === "awaiting_trame") return true;

  if (
    params.aggregate.phase === "dimension_iteration" &&
    (!params.aggregate.currentWorkset ||
      (params.aggregate.currentWorkset.questions?.length ?? 0) === 0)
  ) {
    return true;
  }

  if (
    params.aggregate.phase === "iteration_validation" &&
    !params.aggregate.currentWorkset
  ) {
    return true;
  }

  return false;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = String(searchParams.get("id") ?? "").trim();

    if (!sessionId) {
      return NextResponse.json(
        { ok: false, error: "Missing id" },
        { status: 400 }
      );
    }

    const effectiveUserId = await getEffectiveUserId();
    const admin = adminSupabase();

    const { data: sessionOwner, error: ownerErr } = await admin
      .from("diagnostic_sessions")
      .select("id, user_id")
      .eq("id", sessionId)
      .maybeSingle();

    if (ownerErr) {
      return NextResponse.json(
        { ok: false, error: ownerErr.message },
        { status: 500 }
      );
    }

    if (!sessionOwner) {
      return NextResponse.json(
        { ok: false, error: "Session not found" },
        { status: 404 }
      );
    }

    if (
      !isBypass() &&
      String(sessionOwner.user_id ?? "") !== effectiveUserId
    ) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const loaded = await loadAggregate(sessionId);
    const row = loaded.row;
    let aggregate = loaded.aggregate;

    if (aggregateNeedsRecovery({ row, aggregate })) {
      aggregate = await bootstrapSessionFromTrameWithLlm({
        sessionId,
        rawTrameText: String(row.extracted_text),
      });
      await saveAggregate(sessionId, aggregate);
    }

    const activeQuestionBatch =
      aggregate?.phase === "dimension_iteration" && aggregate.currentWorkset?.questions
        ? aggregate.currentWorkset.questions
        : [];

    return NextResponse.json({
      ok: true,
      session: {
        id: row.id,
        user_id: row.user_id ?? undefined,
        status: mapSessionStatus(aggregate?.phase ?? row.phase, row.status),
        phase: aggregate?.phase ?? row.phase ?? undefined,
        dimension: aggregate?.currentDimensionId ?? row.dimension ?? undefined,
        iteration: aggregate?.currentIteration ?? row.iteration ?? undefined,
        question_index:
          aggregate?.currentWorkset?.answers.length ??
          row.question_index ??
          0,
        source_filename: row.source_filename ?? null,
        created_at: row.created_at ?? null,
        updated_at: row.updated_at ?? null,
        trame_pdf_path: row.source_doc_path ?? null,
        has_trame_index: Boolean(aggregate?.trame),
        has_extracted_text: Boolean(row.extracted_text),
      },
      engine_state: {
        question_batch_json: activeQuestionBatch.map((q) => ({
          fact_id: q.signalId,
          theme: q.theme,
          constat: q.constat,
          risque_managerial: q.risqueManagerial,
          question: q.questionOuverte,
        })),
        final_objectives_json: aggregate?.finalObjectives ?? null,
        consolidation_json: aggregate?.frozenDimensions ?? [],
        conversation_history_json: aggregate?.conversationHistory ?? [],
        theme_coverage_json: aggregate?.themeCoverage ?? [],
        bilan_state_json: aggregate ?? null,
      },
    });
  } catch (e: any) {
    const msg = e?.message ?? "Context error";
    const code = msg === "UNAUTHENTICATED" ? 401 : 500;

    return NextResponse.json(
      {
        ok: false,
        error: msg,
      },
      { status: code }
    );
  }
}
