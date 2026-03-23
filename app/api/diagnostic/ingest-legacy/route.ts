import { NextResponse } from "next/server";
import { adminSupabase, createSupabaseServerClient } from "@/lib/supabaseServer";
import { ingestLegacyDiagnostics } from "@/lib/diagnostic/legacyDiagnosticIngestion";
import type { LegacyDiagnosticInput, KnowledgePattern } from "@/lib/diagnostic/knowledgeBase";

export const runtime = "nodejs";

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

function normalizeLegacyDiagnosticInput(raw: any): LegacyDiagnosticInput | null {
  const source_ref = String(raw?.source_ref ?? "").trim();
  const content = String(raw?.content ?? "").trim();

  if (!source_ref || !content) {
    return null;
  }

  return {
    source_ref,
    company_name: String(raw?.company_name ?? "").trim() || undefined,
    sector: String(raw?.sector ?? "").trim() || undefined,
    size_band: String(raw?.size_band ?? "").trim() || undefined,
    geography: String(raw?.geography ?? "").trim() || undefined,
    content,
  };
}

function toInsertRow(userId: string, pattern: KnowledgePattern) {
  return {
    id: pattern.id,
    user_id: userId,
    source_type: pattern.source_type,
    source_ref: pattern.source_ref,
    dimension: pattern.dimension,
    themes: pattern.themes,
    facts: pattern.facts,
    finding: pattern.finding,
    managerial_risk: pattern.managerial_risk,
    recommendation: pattern.recommendation ?? null,
    evidence_level: pattern.evidence_level,
    context_tags: pattern.context_tags,
    company_profile: pattern.company_profile ?? null,
    sector: pattern.sector ?? null,
    size_band: pattern.size_band ?? null,
    geography: pattern.geography ?? null,
    confidence_score: pattern.confidence_score,
    created_at: pattern.created_at,
  };
}

export async function POST(req: Request) {
  try {
    const userId = await getUserId();
    const admin = adminSupabase();
    const body = await req.json();

    const rawDiagnostics = Array.isArray(body?.diagnostics)
      ? body.diagnostics
      : body?.diagnostic
      ? [body.diagnostic]
      : [];

    const diagnostics = rawDiagnostics
      .map(normalizeLegacyDiagnosticInput)
      .filter(Boolean) as LegacyDiagnosticInput[];

    if (diagnostics.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "Aucun diagnostic exploitable fourni",
        },
        { status: 400 }
      );
    }

    const knowledgeBase = ingestLegacyDiagnostics(diagnostics);
    const patterns = knowledgeBase.patterns;

    if (patterns.length === 0) {
      return NextResponse.json({
        ok: true,
        inserted: 0,
        diagnostics_received: diagnostics.length,
        message:
          "Les diagnostics ont été reçus mais aucun pattern exploitable n’a pu être extrait.",
      });
    }

    const rows = patterns.map((pattern) => toInsertRow(userId, pattern));

    const { error } = await admin
      .from("diagnostic_knowledge_patterns")
      .upsert(rows, { onConflict: "id" });

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      diagnostics_received: diagnostics.length,
      inserted: rows.length,
      message: "Base de connaissance alimentée avec succès.",
    });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const code = msg === "UNAUTHENTICATED" ? 401 : 500;

    return NextResponse.json(
      { ok: false, error: msg },
      { status: code }
    );
  }
}