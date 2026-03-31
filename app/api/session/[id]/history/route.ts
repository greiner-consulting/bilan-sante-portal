import { NextResponse } from "next/server";
import { adminSupabase, createSupabaseServerClient } from "@/lib/supabaseServer";
import {
  loadAggregate,
  loadDiagnosticEvents,
  type DiagnosticEventRow,
} from "@/lib/bilan-sante/session-repository";
import type { ConversationTurn } from "@/lib/bilan-sante/session-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isBypass() {
  return (
    process.env.DEV_BYPASS_AUTH === "1" ||
    process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "1"
  );
}

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function safeFilePart(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function formatDateTime(value?: string | null): string {
  const text = normalizeText(value);
  if (!text) return "n/a";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function roleLabel(turn: ConversationTurn): string {
  switch (turn.role) {
    case "assistant":
      return "Assistant";
    case "question":
      return "Question";
    case "system":
      return "Système";
    case "user":
    default:
      return "Utilisateur";
  }
}

function buildTranscript(params: {
  sourceFilename: string;
  sessionId: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  phase?: string | null;
  turns: ConversationTurn[];
  eventRows: DiagnosticEventRow[];
}): string {
  const lines: string[] = [];
  lines.push("Historique du diagnostic — Bilan de Santé");
  lines.push("");
  lines.push(`Trame : ${params.sourceFilename || "Trame non renseignée"}`);
  lines.push(`Session : ${params.sessionId}`);
  lines.push(`Créée le : ${formatDateTime(params.createdAt)}`);
  lines.push(`Dernière mise à jour : ${formatDateTime(params.updatedAt)}`);
  lines.push(`Phase courante : ${normalizeText(params.phase) || "n/a"}`);
  lines.push(`Nombre de tours conservés : ${params.turns.length}`);
  lines.push(`Nombre d'événements stockés : ${params.eventRows.length}`);
  lines.push("");
  lines.push("Déroulé du dashboard");
  lines.push("-------------------");

  params.turns.forEach((turn, index) => {
    const text = normalizeText(turn.text);
    if (!text) return;
    const meta: string[] = [];
    if (turn.dimensionId != null) meta.push(`dimension ${turn.dimensionId}`);
    if (turn.iteration != null) meta.push(`itération ${turn.iteration}/3`);
    if (turn.theme) meta.push(`thème ${turn.theme}`);
    if (turn.ordinal != null && turn.total != null) {
      meta.push(`question ${turn.ordinal}/${turn.total}`);
    }

    lines.push(
      `${index + 1}. ${roleLabel(turn)} — ${formatDateTime(turn.createdAt)}${
        meta.length > 0 ? ` — ${meta.join(" | ")}` : ""
      }`
    );
    lines.push(text);
    lines.push("");
  });

  lines.push("Journal événementiel");
  lines.push("-------------------");
  params.eventRows.forEach((event, index) => {
    lines.push(
      `${index + 1}. ${formatDateTime(event.created_at)} — ${event.kind}`
    );
    const payload = event.payload ? JSON.stringify(event.payload, null, 2) : "{}";
    lines.push(payload);
    lines.push("");
  });

  return lines.join("\n");
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

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await context.params;
    const { searchParams } = new URL(req.url);
    const format = normalizeText(searchParams.get("format") ?? "json").toLowerCase();

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
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (!sessionOwner) {
      return NextResponse.json(
        { ok: false, error: "Session not found" },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (!isBypass() && String(sessionOwner.user_id ?? "") !== effectiveUserId) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      );
    }

    const loaded = await loadAggregate(sessionId);
    const aggregate = loaded.aggregate;
    const events = await loadDiagnosticEvents(sessionId);

    if (!aggregate) {
      return NextResponse.json(
        { ok: false, error: "BILAN_STATE_NOT_FOUND" },
        { status: 409, headers: { "Cache-Control": "no-store" } }
      );
    }

    const sourceFilename = normalizeText(loaded.row.source_filename) || "trame_bilan_sante";
    const safeBaseName = safeFilePart(sourceFilename.replace(/\.docx$/i, "")) || "trame_bilan_sante";

    const archive = {
      ok: true,
      exportedAt: new Date().toISOString(),
      session: {
        id: loaded.row.id,
        source_filename: loaded.row.source_filename ?? null,
        created_at: loaded.row.created_at ?? null,
        updated_at: loaded.row.updated_at ?? null,
        phase: aggregate.phase,
        status: loaded.row.status ?? null,
      },
      archive: {
        aggregate,
        conversation_history: aggregate.conversationHistory ?? [],
        frozen_dimensions: aggregate.frozenDimensions ?? [],
        final_objectives: aggregate.finalObjectives ?? null,
        diagnostic_events: events,
      },
    };

    if (format === "text" || format === "txt") {
      const text = buildTranscript({
        sourceFilename,
        sessionId,
        createdAt: loaded.row.created_at,
        updatedAt: loaded.row.updated_at,
        phase: aggregate.phase,
        turns: aggregate.conversationHistory ?? [],
        eventRows: events,
      });

      return new Response(text, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="Historique_Diagnostic_${safeBaseName}.txt"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json(archive, {
      headers: {
        "Content-Disposition": `attachment; filename="Historique_Diagnostic_${safeBaseName}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    const msg = e?.message ?? "History export error";
    const code = msg === "UNAUTHENTICATED" ? 401 : 500;

    return NextResponse.json(
      {
        ok: false,
        error: msg,
      },
      { status: code, headers: { "Cache-Control": "no-store" } }
    );
  }
}
