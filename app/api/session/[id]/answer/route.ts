import { NextResponse } from "next/server";
import {
  processSessionInput,
  bootstrapOrReadSession,
} from "@/lib/bilan-sante/session-service";
import {
  adminSupabase,
  createSupabaseServerClient,
} from "@/lib/supabaseServer";
import { loadAggregate } from "@/lib/bilan-sante/session-repository";

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

type SessionLookupRow = {
  id: string;
  user_id: string | null;
};

type ClientQuestionSync = {
  client_phase?: string | null;
  client_dimension_id?: number | string | null;
  client_iteration?: number | string | null;
  client_question_index?: number | string | null;
  client_fact_id?: string | null;
  client_question_text?: string | null;
};

type SyncCheckResult =
  | { ok: true }
  | {
      ok: false;
      reason: string;
      server?: Record<string, unknown>;
      client?: Record<string, unknown>;
    };

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeForMatch(value: unknown): string {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || typeof value === "undefined" || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function hasClientQuestionSync(body: Record<string, unknown>): boolean {
  return [
    "client_phase",
    "client_dimension_id",
    "client_iteration",
    "client_question_index",
    "client_fact_id",
    "client_question_text",
  ].some((key) => typeof body[key] !== "undefined" && body[key] !== null);
}

function getCurrentUnansweredQuestion(aggregate: any): any | null {
  const workset = aggregate?.currentWorkset;
  if (!workset || !Array.isArray(workset.questions)) return null;

  const answered = new Set(
    Array.isArray(workset.answers)
      ? workset.answers.map((answer: any) => String(answer?.questionId ?? ""))
      : []
  );

  return workset.questions.find((question: any) => !answered.has(String(question?.id ?? ""))) ?? null;
}

function getAnsweredCount(aggregate: any): number {
  const answers = aggregate?.currentWorkset?.answers;
  return Array.isArray(answers) ? answers.length : 0;
}

function questionText(question: any): string {
  return normalizeText(question?.questionOuverte ?? question?.question ?? "");
}

function questionSignalId(question: any): string {
  return normalizeText(question?.signalId ?? question?.fact_id ?? "");
}

async function checkClientQuestionSync(
  sessionId: string,
  body: ClientQuestionSync
): Promise<SyncCheckResult> {
  const loaded = await loadAggregate(sessionId);
  const aggregate: any = loaded.aggregate;

  if (!aggregate) return { ok: true };
  if (aggregate.phase !== "dimension_iteration") return { ok: true };

  const currentQuestion = getCurrentUnansweredQuestion(aggregate);
  if (!currentQuestion) return { ok: true };

  const server = {
    phase: aggregate.phase,
    dimensionId: aggregate.currentDimensionId ?? aggregate.currentWorkset?.dimensionId ?? null,
    iteration: aggregate.currentIteration ?? aggregate.currentWorkset?.iteration ?? null,
    questionIndex: getAnsweredCount(aggregate),
    factId: questionSignalId(currentQuestion),
    questionText: questionText(currentQuestion),
  };

  const client = {
    phase: normalizeText(body.client_phase),
    dimensionId: toFiniteNumber(body.client_dimension_id),
    iteration: toFiniteNumber(body.client_iteration),
    questionIndex: toFiniteNumber(body.client_question_index),
    factId: normalizeText(body.client_fact_id),
    questionText: normalizeText(body.client_question_text),
  };

  if (!client.phase || client.dimensionId === null || client.iteration === null || client.questionIndex === null) {
    return { ok: false, reason: "missing_client_question_sync", server, client };
  }

  if (client.phase !== "dimension_iteration") {
    return { ok: false, reason: "client_not_in_question_phase", server, client };
  }

  if (client.dimensionId !== Number(server.dimensionId)) {
    return { ok: false, reason: "dimension_mismatch", server, client };
  }

  if (client.iteration !== Number(server.iteration)) {
    return { ok: false, reason: "iteration_mismatch", server, client };
  }

  if (client.questionIndex !== Number(server.questionIndex)) {
    return { ok: false, reason: "question_index_mismatch", server, client };
  }

  if (client.factId && server.factId && client.factId !== server.factId) {
    return { ok: false, reason: "signal_mismatch", server, client };
  }

  const serverQuestion = normalizeForMatch(server.questionText);
  const clientQuestion = normalizeForMatch(client.questionText);
  if (clientQuestion && serverQuestion && clientQuestion !== serverQuestion) {
    return { ok: false, reason: "question_text_mismatch", server, client };
  }

  return { ok: true };
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await context.params;
    const body = (await req.json()) as Record<string, unknown>;

    const message = String(body?.message ?? "").trim();
    const objectiveDecisions = Array.isArray(body?.objectiveDecisions)
      ? body.objectiveDecisions
      : undefined;

    if (!sessionId) {
      return NextResponse.json(
        { ok: false, error: "Missing session id" },
        { status: 400 }
      );
    }

    const effectiveUserId = await getEffectiveUserId();
    const admin = adminSupabase();

    const { data: sessionRow, error: sessionLookupError } = await admin
      .from("diagnostic_sessions")
      .select("id, user_id")
      .eq("id", sessionId)
      .maybeSingle();

    if (sessionLookupError) {
      throw new Error(`Session lookup failed: ${sessionLookupError.message}`);
    }

    if (!sessionRow) {
      return NextResponse.json(
        { ok: false, error: "Session not found" },
        { status: 404 }
      );
    }

    if (
      !isBypass() &&
      String((sessionRow as SessionLookupRow).user_id ?? "") !== effectiveUserId
    ) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    if (message && hasClientQuestionSync(body)) {
      const sync = await checkClientQuestionSync(sessionId, body as ClientQuestionSync);
      if (!sync.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: "SYNC_REQUIRED",
            sync_required: true,
            reason: sync.reason,
            assistant_message:
              "L’écran et le moteur ne sont plus synchronisés. Je recharge la question active avant d’enregistrer votre réponse.",
            server: sync.server,
            client: sync.client,
          },
          { status: 409 }
        );
      }
    }

    const payload =
      !message && !objectiveDecisions
        ? await bootstrapOrReadSession({
            sessionId,
            userId: effectiveUserId,
          })
        : await processSessionInput({
            sessionId,
            userId: effectiveUserId,
            message,
            objectiveDecisions,
          });

    return NextResponse.json({
      ok: true,
      ...payload,
    });
  } catch (e: any) {
    const msg = e?.message ?? "Engine error";
    const code =
      msg === "UNAUTHENTICATED"
        ? 401
        : msg === "TRAME_NOT_INGESTED"
        ? 400
        : 500;

    return NextResponse.json(
      {
        ok: false,
        error: msg,
      },
      { status: code }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { ok: false, error: "Method Not Allowed" },
    { status: 405 }
  );
}
