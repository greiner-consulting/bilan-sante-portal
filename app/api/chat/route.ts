// app/api/chat/route.ts

import { NextResponse } from "next/server";
import type { ObjectiveDecisionInput } from "@/lib/bilan-sante/objectives-builder";
import {
  adminSupabase,
  createSupabaseServerClient,
} from "@/lib/supabaseServer";
import {
  bootstrapOrReadSession,
  processSessionInput,
} from "@/lib/bilan-sante/session-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBypass() {
  return (
    process.env.DEV_BYPASS_AUTH === "1" ||
    process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "1"
  );
}

async function getUserId(): Promise<string> {
  if (isBypass()) {
    const id = process.env.DEV_BYPASS_USER_ID;
    if (!id) {
      throw new Error("Missing DEV_BYPASS_USER_ID");
    }
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

function normalizeIncomingMessage(raw: unknown): string {
  return String(raw ?? "").trim();
}

function isObjectiveDecisionStatus(
  value: unknown
): value is ObjectiveDecisionInput["status"] {
  return value === "validated" || value === "adjusted" || value === "refused";
}

function normalizeOptionalText(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : undefined;
}

function normalizeObjectiveDecision(
  value: unknown
): ObjectiveDecisionInput | null {
  if (!isRecord(value)) {
    return null;
  }

  const objectiveId = normalizeOptionalText(value.objectiveId);
  const status = value.status;

  if (!objectiveId || !isObjectiveDecisionStatus(status)) {
    return null;
  }

  return {
    objectiveId,
    status,
    adjustedLabel: normalizeOptionalText(value.adjustedLabel),
    adjustedIndicator: normalizeOptionalText(value.adjustedIndicator),
    adjustedDueDate: normalizeOptionalText(value.adjustedDueDate),
    adjustedPotentialGain: normalizeOptionalText(value.adjustedPotentialGain),
    adjustedQuickWin: normalizeOptionalText(value.adjustedQuickWin),
  };
}

function normalizeObjectiveDecisions(
  raw: unknown
): ObjectiveDecisionInput[] | undefined {
  if (raw == null) {
    return undefined;
  }

  if (!Array.isArray(raw)) {
    throw new Error("INVALID_OBJECTIVE_DECISIONS");
  }

  const normalized = raw
    .map((item) => normalizeObjectiveDecision(item))
    .filter(Boolean) as ObjectiveDecisionInput[];

  if (normalized.length !== raw.length) {
    throw new Error("INVALID_OBJECTIVE_DECISIONS");
  }

  return normalized;
}

async function readJsonBody(req: Request): Promise<JsonRecord> {
  try {
    const body = (await req.json()) as unknown;
    if (!isRecord(body)) {
      throw new Error("INVALID_JSON_BODY");
    }
    return body;
  } catch {
    throw new Error("INVALID_JSON_BODY");
  }
}

function errorStatusFor(message: string): number {
  switch (message) {
    case "UNAUTHENTICATED":
      return 401;
    case "TRAME_NOT_INGESTED":
    case "INVALID_JSON_BODY":
    case "INVALID_OBJECTIVE_DECISIONS":
      return 400;
    default:
      return 500;
  }
}

export async function POST(req: Request) {
  try {
    const body = await readJsonBody(req);
    const sessionId = String(body.sessionId ?? "").trim();
    const rawMessage = normalizeIncomingMessage(body.message);
    const objectiveDecisions = normalizeObjectiveDecisions(
      body.objectiveDecisions
    );

    if (!sessionId) {
      return NextResponse.json(
        { ok: false, error: "Missing sessionId" },
        { status: 400 }
      );
    }

    const userId = await getUserId();
    const admin = adminSupabase();

    const { data: session, error: sessionErr } = await admin
      .from("diagnostic_sessions")
      .select("id,user_id,extracted_text,status,phase")
      .eq("id", sessionId)
      .maybeSingle();

    if (sessionErr) {
      return NextResponse.json(
        { ok: false, error: sessionErr.message },
        { status: 500 }
      );
    }

    if (!session) {
      return NextResponse.json(
        { ok: false, error: "Session not found" },
        { status: 404 }
      );
    }

    if (!isBypass() && session.user_id !== userId) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    if (!session.extracted_text) {
      return NextResponse.json(
        { ok: false, error: "TRAME_NOT_INGESTED" },
        { status: 400 }
      );
    }

    const payload =
      !rawMessage && !objectiveDecisions
        ? await bootstrapOrReadSession({
            sessionId,
            userId,
          })
        : await processSessionInput({
            sessionId,
            userId,
            message: rawMessage,
            objectiveDecisions,
          });

    return NextResponse.json({
      ok: true,

      // compat legacy
      assistant: payload,

      // format direct nouveau noyau
      ...payload,
    });
  } catch (e: unknown) {
    const message =
      e instanceof Error && e.message ? e.message : "Unknown error";

    return NextResponse.json(
      { ok: false, error: message },
      { status: errorStatusFor(message) }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { ok: false, error: "Method Not Allowed" },
    { status: 405 }
  );
}