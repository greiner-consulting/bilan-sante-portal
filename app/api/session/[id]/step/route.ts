export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { z } from "zod";
import { adminSupabase, createSupabaseServerClient } from "@/lib/supabaseServer";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

/**
 * Schéma strict d’une itération 4D
 * - questions: triptyque obligatoire
 * - closure_prompt: validation Oui/Non obligatoire
 */
const StepOutputSchema = z.object({
  header: z.string().min(5),
  questions: z.array(
    z.object({
      q_number: z.number().int().min(1),
      theme: z.string().min(2),
      constat: z.string().min(5),
      risque_managerial: z.string().min(5),
      question_ouverte: z.string().min(5),
    })
  ),
  mini_reformulation: z.string().optional(),
  closure_prompt: z.string().min(10),
});

type StepOutput = z.infer<typeof StepOutputSchema>;

function requiredQuestionCount(iteration: number) {
  // tes règles : it1 = 6+, it2 = 6+, it3 = 5+ (tu peux resserrer)
  if (iteration === 3) return 5;
  return 6;
}

function rulesText(dimension: number, iteration: number) {
  return `
RÈGLES ABSOLUES (BLOQUANTES) :
- Tu produis UNIQUEMENT un objet JSON conforme au schéma demandé.
- Pas de synthèse globale du diagnostic.
- Tu es sur "Dimension ${dimension} — Itération ${iteration}/3".
- Nombre minimum de questions: ${requiredQuestionCount(iteration)}.
- Chaque question DOIT contenir : (1) Constat, (2) Risque managérial, (3) Question ouverte.
- Les thèmes doivent être tous distincts.
- La clôture est obligatoire et doit se terminer par : "(Oui / Non)".
- Si une information manque dans la trame : tu le dis explicitement ("non documenté / non suivi") et tu transformes cela en question de pilotage.
`.trim();
}

function buildUserPrompt(args: {
  dimension: number;
  iteration: number;
  trameIndex: any | null;
  extractedTextPreview: string | null;
}) {
  const { dimension, iteration, trameIndex, extractedTextPreview } = args;

  // Contexte "stable" : sections + tables + flags, et un petit aperçu texte (anti-bloat)
  const ctx = {
    trame_meta: trameIndex?.meta ?? null,
    sections: trameIndex?.sections ?? [],
    tables: trameIndex?.tables ?? {},
    missing_fields: trameIndex?.missing_fields ?? [],
    quality_flags: trameIndex?.quality_flags ?? [],
    extracted_text_preview: extractedTextPreview ?? null,
  };

  return `
Tu es un consultant senior spécialisé en diagnostic d’entreprise. 
Objectif: conduire un diagnostic 4D par itérations contrôlées.

${rulesText(dimension, iteration)}

CONTEXTE TRAME (JSON, source) :
${JSON.stringify(ctx, null, 2)}

TÂCHE :
Génère les questions de l’itération ${iteration}/3 pour la dimension ${dimension}.
- Format: JSON strict (pas de markdown, pas de texte hors JSON).
- header attendu : "Dimension ${dimension} — Itération ${iteration}/3"
- questions: ${requiredQuestionCount(iteration)} à 10 (it3: 5 à 8)
- mini_reformulation : obligatoire pour it1 et it2 (5 à 7 lignes max), optionnelle pour it3
- closure_prompt : exactement une phrase de validation de fin d’itération, terminant par "(Oui / Non)".
`.trim();
}

async function callOpenAIResponses(params: {
  apiKey: string;
  model: string;
  prompt: string;
}) {
  const { apiKey, model, prompt } = params;

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      ],
      // On force une sortie JSON "propre"
      text: { format: { type: "json_object" } },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`OpenAI error ${resp.status}: ${errText}`);
  }

  const data = await resp.json();

  // Le JSON est dans output_text (souvent), sinon on retombe sur d’autres chemins
  // On prend le plus robuste possible:
  const outText =
    data?.output_text ??
    data?.output?.[0]?.content?.find((c: any) => c.type === "output_text")?.text;

  if (!outText || typeof outText !== "string") {
    throw new Error("OpenAI response missing output_text");
  }

  return { raw: data, outText };
}

function validateBusinessRules(out: StepOutput, iteration: number) {
  const minQ = requiredQuestionCount(iteration);
  const issues: string[] = [];

  if (!out.header.includes(`Itération ${iteration}/3`)) issues.push("header_mismatch");
  if (out.questions.length < minQ) issues.push(`too_few_questions:${out.questions.length}<${minQ}`);

  // thèmes distincts
  const themes = out.questions.map((q) => q.theme.trim().toLowerCase());
  const uniqThemes = new Set(themes);
  if (uniqThemes.size !== themes.length) issues.push("duplicate_themes");

  // closure must end with (Oui / Non)
  if (!/\(Oui\s*\/\s*Non\)\s*$/.test(out.closure_prompt)) issues.push("closure_missing_yes_no");

  // mini reformulation : obligatoire it1/it2
  if (iteration !== 3) {
    if (!out.mini_reformulation || out.mini_reformulation.trim().length < 20) {
      issues.push("missing_mini_reformulation");
    }
  }

  // triptyque
  for (const q of out.questions) {
    if (!q.constat?.trim()) issues.push(`missing_constat_q${q.q_number}`);
    if (!q.risque_managerial?.trim()) issues.push(`missing_risque_q${q.q_number}`);
    if (!q.question_ouverte?.trim()) issues.push(`missing_question_q${q.q_number}`);
  }

  return issues;
}

export async function POST(req: Request, ctx: { params: { id: string } }) {
  const sessionId = ctx.params.id;
  if (!sessionId) return json({ ok: false, error: "Missing session id" }, 400);

  // Auth user (cookie SSR)
  const supabaseSSR = await createSupabaseServerClient();
  const { data: { user } } = await supabaseSSR.auth.getUser();
  if (!user) return json({ ok: false, error: "Unauthorized" }, 401);

  const admin = adminSupabase();

  // Load session
  const { data: session, error: sErr } = await admin
    .from("diagnostic_sessions")
    .select("id, user_id, status, dimension, iteration, trame_index_id, extracted_text")
    .eq("id", sessionId)
    .maybeSingle();

  if (sErr) return json({ ok: false, error: sErr.message }, 500);
  if (!session) return json({ ok: false, error: "Session not found" }, 404);
  if (session.user_id !== user.id) return json({ ok: false, error: "Forbidden" }, 403);

  // Must have trame index to start (sinon on ne peut pas “ancrer”)
  if (!session.trame_index_id) {
    return json(
      { ok: false, error: "TRAME_NOT_INGESTED", hint: "Call POST /api/trame/ingest first." },
      409
    );
  }

  // Load trame index
  const { data: idx, error: iErr } = await admin
    .from("trame_indexes")
    .select("id, index_version, index_json")
    .eq("id", session.trame_index_id)
    .maybeSingle();

  if (iErr) return json({ ok: false, error: iErr.message }, 500);
  if (!idx) return json({ ok: false, error: "Trame index not found" }, 404);

  const dimension = session.dimension ?? 1;
  const iteration = session.iteration ?? 1;

  // Preview texte (limité pour tokens)
  const extractedTextPreview =
    typeof session.extracted_text === "string"
      ? session.extracted_text.slice(0, 5000)
      : null;

  // Log request event (non bloquant)
  await admin.from("diagnostic_events").insert({
    session_id: sessionId,
    user_id: user.id,
    kind: "STEP_REQUESTED",
    payload: { dimension, iteration, trame_index_id: idx.id, index_version: idx.index_version },
  });

  const prompt = buildUserPrompt({
    dimension,
    iteration,
    trameIndex: idx.index_json,
    extractedTextPreview,
  });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return json({ ok: false, error: "Missing OPENAI_API_KEY" }, 500);

  const model = process.env.OPENAI_MODEL_STEP || "gpt-4.1-mini";

  let outText = "";
  let parsed: any;

  try {
    const r = await callOpenAIResponses({ apiKey, model, prompt });
    outText = r.outText;
    parsed = JSON.parse(outText);
  } catch (e: any) {
    await admin.from("diagnostic_events").insert({
      session_id: sessionId,
      user_id: user.id,
      kind: "STEP_FAILED",
      payload: { dimension, iteration, error: e?.message ?? String(e) },
    });
    return json({ ok: false, error: e?.message ?? String(e) }, 500);
  }

  // Validate schema
  const safe = StepOutputSchema.safeParse(parsed);
  if (!safe.success) {
    await admin.from("diagnostic_events").insert({
      session_id: sessionId,
      user_id: user.id,
      kind: "MODEL_REPLY_INVALID_SCHEMA",
      payload: { dimension, iteration, issues: safe.error.issues, raw: parsed },
    });
    return json(
      { ok: false, error: "INVALID_SCHEMA", details: safe.error.issues },
      422
    );
  }

  const step = safe.data;

  // Validate business rules
  const issues = validateBusinessRules(step, iteration);

  // Log model reply
  await admin.from("diagnostic_events").insert({
    session_id: sessionId,
    user_id: user.id,
    kind: "MODEL_REPLY",
    payload: {
      dimension,
      iteration,
      header: step.header,
      question_count: step.questions.length,
      issues,
      step,
    },
  });

  // If first step, move status to in_progress (non bloquant si déjà in_progress)
  if (session.status === "ready" || session.status === "collected") {
    await admin.from("diagnostic_sessions").update({ status: "in_progress" }).eq("id", sessionId);
  }

  // On renvoie quand même le contenu, mais on signale les issues si présentes
  return json(
    {
      ok: true,
      session: { id: sessionId, status: "in_progress", dimension, iteration },
      step,
      compliance: { ok: issues.length === 0, issues },
    },
    200
  );
}