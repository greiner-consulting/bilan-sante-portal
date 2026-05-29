import { adminSupabase } from "@/lib/supabaseServer";
import OpenAI from "openai";

import type { StructuredQuestion } from "@/lib/diagnostic/types";
import type {
  AnalysisStep,
  CoverageState,
  DiagnosticDimensionResult,
  DiagnosticResult,
  FactBackedQuestion,
  SignalAngle,
  SignalProgress,
} from "@/lib/diagnostic/types";

import type { KnowledgeBase, DimensionId } from "@/lib/diagnostic/knowledgeBase";
import {
  createKnowledgeBase,
  retrieveRelevantPatterns,
  serializeRetrievedPatterns,
} from "@/lib/diagnostic/knowledgeBase";

import {
  clampDimension,
  clampIteration,
  dimensionName,
  hasExpectedBatchSize,
  iterationTitle,
  toDimensionKey,
  type IterationMode,
} from "@/lib/diagnostic/diagnosticContracts";

import {
  buildAnalysisFallback,
  computeDiagnosticSynthesis,
  defaultBucket,
  deriveQuestionIntent,
  ensureGlobalAnalysis,
  formatIntentMemory,
  limitUnique,
  normalizeCoverage,
  normalizeDiagnosticResult,
  normalizeGlobalAnalysis,
  normalizeQuestionBatch,
  refreshDimensionMemory,
  uniquePush,
  updateCoverageWithAnalysis,
} from "@/lib/diagnostic/diagnosticState";

import { ensureFactInventory } from "@/lib/diagnostic/diagnosticQuestionPlanner";
import { buildQuestionBatchLLM as buildQuestionBatch } from "@/lib/diagnostic/questionBatchLLM";

import { consolidateDimensionResult } from "@/lib/diagnostic/diagnosticDimensionConsolidator";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

type AssistantJSON = {
  assistant_message: string;
  questions: StructuredQuestion[];
  needs_validation: boolean;
};

type SessionRow = {
  id: string;
  extracted_text: string | null;
  dimension?: number | null;
  iteration?: number | null;
  status?: string | null;
  phase?: string | null;
  coverage_json?: unknown;
  global_analysis_json?: unknown;
  diagnostic_result_json?: unknown;
  final_objectives_json?: unknown;
  question_batch_json?: unknown;
  question_index?: number | null;
  consolidation_json?: unknown;
};

type FinalObjective = {
  id: string;
  dimensionId: number;
  objectiveLabel: string;
  owner: string;
  keyIndicator: string;
  dueDate: string;
  potentialGain: string;
  gainHypotheses: string[];
  validationStatus: "proposed" | "validated" | "adjusted" | "refused";
  quickWin: string;
};

type FinalObjectiveSet = {
  header: string;
  objectives: FinalObjective[];
  decisionsCapturedAt?: string;
};

const DEBUG_DIAGNOSTIC = true;

function debugLog(scope: string, payload: Record<string, unknown>) {
  if (!DEBUG_DIAGNOSTIC) return;
  console.log(`[diagnostic][${scope}]`, JSON.stringify(payload, null, 2));
}

function isYes(message: string) {
  return ["oui", "ok", "valide", "validé", "yes"].includes(
    message.trim().toLowerCase()
  );
}

function isNo(message: string) {
  return ["non", "no"].includes(message.trim().toLowerCase());
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim()
  );
}

function normalizeAngle(value: string): SignalAngle | null {
  const x = String(value || "").trim().toLowerCase();

  if (["example", "cas", "illustration"].includes(x)) return "example";
  if (["magnitude", "quantification", "ordre de grandeur"].includes(x)) {
    return "magnitude";
  }
  if (["mechanism", "mecanisme"].includes(x)) return "mechanism";
  if (["causality", "cause", "causalite"].includes(x)) return "causality";
  if (["dependency", "dependance"].includes(x)) return "dependency";
  if (["arbitration", "arbitrage"].includes(x)) return "arbitration";
  if (["formalization", "formalisme"].includes(x)) return "formalization";
  if (["transition"].includes(x)) return "transition";
  if (["economics", "economic", "economique"].includes(x)) return "economics";
  if (["frequency", "frequence"].includes(x)) return "frequency";
  if (
    ["feedback", "rex", "retour d'experience", "retour d experience"].includes(
      x
    )
  ) {
    return "feedback";
  }

  return null;
}

function normalizeProgress(value: string): SignalProgress | null {
  const x = String(value || "").trim();

  if (
    x === "identified" ||
    x === "questioned" ||
    x === "illustrated" ||
    x === "quantified" ||
    x === "causalized" ||
    x === "arbitrated" ||
    x === "stabilized" ||
    x === "consolidated"
  ) {
    return x;
  }

  return null;
}

function limitUniqueAngles(values: SignalAngle[], max = 6): SignalAngle[] {
  const out: SignalAngle[] = [];
  for (const value of values) {
    if (!out.includes(value)) out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

function convertBatchToStructuredQuestions(
  batch: FactBackedQuestion[]
): StructuredQuestion[] {
  return batch.map((q) => ({
    constat: q.constat,
    risque_managerial: q.risque_managerial,
    question: q.question,
    fact_id: q.fact_id,
    theme: q.theme,
  }));
}

function extractThemes(batch: FactBackedQuestion[]): string[] {
  return batch.map((q: FactBackedQuestion) => q.theme);
}

function buildHistory(events: Array<{ kind?: string; payload?: any }>): string {
  return events
    .map((e) => {
      const kind = String(e?.kind ?? "");
      const payload = e?.payload ?? {};

      if (kind === "CHAT_USER") {
        return `Dirigeant: ${String(payload?.message ?? "").trim()}`;
      }

      if (kind === "CHAT_ASSISTANT") {
        const msg = String(payload?.assistant_message ?? "").trim();
        const qs = Array.isArray(payload?.questions)
          ? payload.questions
              .map((q: any) => String(q?.question ?? "").trim())
              .filter(Boolean)
              .join(" | ")
          : "";

        return `Assistant: ${msg}${qs ? ` Questions: ${qs}` : ""}`;
      }

      if (kind === "QUESTION_ANSWER") {
        return `Réponse structurée: ${String(payload?.answer ?? "").trim()}`;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n");
}

async function loadKnowledgeBaseForUser(
  _userId: string
): Promise<KnowledgeBase> {
  try {
    return createKnowledgeBase([]);
  } catch {
    return createKnowledgeBase([]);
  }
}

function inferCoveredAnglesFromText(texts: string[]): SignalAngle[] {
  const joined = texts.join(" | ").toLowerCase();
  const angles: SignalAngle[] = [];

  if (
    joined.includes("exemple") ||
    joined.includes("cas récent") ||
    joined.includes("cas recent") ||
    joined.includes("je peux vous citer") ||
    joined.includes("par exemple")
  ) {
    angles.push("example");
  }

  if (
    joined.includes("ordre de grandeur") ||
    joined.includes("combien") ||
    joined.includes("part") ||
    joined.includes("volume") ||
    joined.includes("montant")
  ) {
    angles.push("magnitude");
  }

  if (
    joined.includes("dans la pratique") ||
    joined.includes("concrètement") ||
    joined.includes("concretement") ||
    joined.includes("ça se passe") ||
    joined.includes("ca se passe") ||
    joined.includes("fonctionne")
  ) {
    angles.push("mechanism");
  }

  if (
    joined.includes("explique") ||
    joined.includes("parce que") ||
    joined.includes("la cause") ||
    joined.includes("vient de") ||
    joined.includes("s'explique")
  ) {
    angles.push("causality");
  }

  if (
    joined.includes("dépend") ||
    joined.includes("depend") ||
    joined.includes("personne clé") ||
    joined.includes("personne cle") ||
    joined.includes("quelques personnes") ||
    joined.includes("si x n'est pas là") ||
    joined.includes("si x n'est pas la")
  ) {
    angles.push("dependency");
  }

  if (
    joined.includes("qui décide") ||
    joined.includes("qui decide") ||
    joined.includes("qui tranche") ||
    joined.includes("arbitrage")
  ) {
    angles.push("arbitration");
  }

  if (
    joined.includes("formalis") ||
    joined.includes("procédure") ||
    joined.includes("procedure") ||
    joined.includes("cadre") ||
    joined.includes("règle") ||
    joined.includes("regle")
  ) {
    angles.push("formalization");
  }

  if (
    joined.includes("bloque") ||
    joined.includes("empêche") ||
    joined.includes("empeche") ||
    joined.includes("pour passer à")
  ) {
    angles.push("transition");
  }

  if (
    joined.includes("coût") ||
    joined.includes("cout") ||
    joined.includes("charge") ||
    joined.includes("retard") ||
    joined.includes("impact") ||
    joined.includes("productivité") ||
    joined.includes("productivite")
  ) {
    angles.push("economics");
  }

  if (
    joined.includes("souvent") ||
    joined.includes("tous les") ||
    joined.includes("chaque semaine") ||
    joined.includes("fréquence") ||
    joined.includes("frequence")
  ) {
    angles.push("frequency");
  }

  if (
    joined.includes("retour d'expérience") ||
    joined.includes("retour d experience") ||
    joined.includes("on a appris") ||
    joined.includes("on a changé")
  ) {
    angles.push("feedback");
  }

  return limitUniqueAngles(angles, 6);
}

function registerConsumedQuestion(params: {
  coverage: CoverageState;
  dimension: number;
  iteration: number;
  question: FactBackedQuestion;
}): CoverageState {
  const { coverage, dimension, iteration, question } = params;

  const bucket =
    coverage.dimensions[toDimensionKey(dimension)] ?? defaultBucket(dimension);

  if (!bucket.targeted_fact_ids.includes(question.fact_id)) {
    bucket.targeted_fact_ids.push(question.fact_id);
  }

  uniquePush(bucket.validations, [
    formatIntentMemory(
      deriveQuestionIntent(question.question, question.theme, iteration)
    ),
  ]);

  if (question.intended_angle) {
    bucket.recent_angles = limitUniqueAngles(
      [...(bucket.recent_angles ?? []), question.intended_angle],
      8
    );
  }

  bucket.planned_themes = limitUnique(
    [...(bucket.planned_themes ?? []), question.theme],
    8
  );

  const fact = coverage.fact_inventory.find((f) => f.id === question.fact_id);

  if (fact && question.intended_angle) {
    fact.asked_angles = limitUniqueAngles(
      [...(fact.asked_angles ?? []), question.intended_angle],
      8
    );

    fact.last_planned_angle = question.intended_angle;
    fact.progress = fact.progress ?? "questioned";

    fact.missing_angles = (fact.missing_angles ?? []).filter(
      (angle) => angle !== question.intended_angle
    );

    const mutableFact = fact as any;

    if (!Array.isArray(mutableFact.previous_questions)) {
      mutableFact.previous_questions = [];
    }

    const questionText = String(question.question || "").trim();

    if (
      questionText &&
      !mutableFact.previous_questions.some(
        (q: string) =>
          String(q || "").trim().toLowerCase() === questionText.toLowerCase()
      )
    ) {
      mutableFact.previous_questions.push(questionText);
      mutableFact.previous_questions = mutableFact.previous_questions.slice(-10);
    }
  }

  return refreshDimensionMemory(coverage, dimension);
}

async function analyzeUserAnswer(params: {
  extractedText: string;
  dimension: number;
  iteration: number;
  history: string;
  userMessage: string;
  coverage: CoverageState;
  activeQuestion?: FactBackedQuestion | null;
  knowledgeBase: KnowledgeBase;
}): Promise<AnalysisStep | null> {
  const {
    extractedText,
    dimension,
    iteration,
    history,
    userMessage,
    coverage,
    activeQuestion,
    knowledgeBase,
  } = params;

  const bucket =
    coverage.dimensions[toDimensionKey(dimension)] ?? defaultBucket(dimension);

  const activeFact =
    activeQuestion?.fact_id != null
      ? coverage.fact_inventory.find((f) => f.id === activeQuestion.fact_id)
      : null;

  const knowledgeSnippet = serializeRetrievedPatterns(
    retrieveRelevantPatterns({
      knowledgeBase,
      dimension: dimension as DimensionId,
      extractedText,
      learnedFacts: bucket.learned_facts,
      validatedFindings: bucket.validated_findings,
      targetThemes: bucket.coveredThemes,
      limit: 5,
    })
  );

  const intendedAngle =
    activeQuestion?.intended_angle ?? activeFact?.last_planned_angle;
  const inferredFallbackAngles = inferCoveredAnglesFromText([userMessage]);

  const prompt = `
Tu es un consultant senior spécialisé en redressement de PME.

Tu analyses UNE réponse de dirigeant dans un entretien structuré de diagnostic.

Tu dois seulement extraire ce que la réponse apporte réellement sur le signal visé.

Réponds STRICTEMENT en JSON :

{
  "new_signals": ["string"],
  "new_evidences": ["string"],
  "validated_findings": ["string"],
  "open_hypotheses": ["string"],
  "resolved_topics": ["string"],
  "contradictions": ["string"],
  "covered_themes": ["string"],
  "theme_status_updates": [
    {
      "theme": "string",
      "status": "unseen|exploring|covered|resolved"
    }
  ],
  "next_best_angle": "string",
  "confidence_score": 0,
  "covered_angles": ["example|magnitude|mechanism|causality|dependency|arbitration|formalization|transition|economics|frequency|feedback"],
  "signal_updates": [
    {
      "fact_id": "string",
      "progress": "identified|questioned|illustrated|quantified|causalized|arbitrated|stabilized|consolidated",
      "newly_covered_angles": ["example"],
      "remaining_angles": ["mechanism"]
    }
  ]
}

Règles :
- validated_findings seulement si la réponse apporte un fait, un mécanisme ou un arbitrage explicite
- pas de surinterprétation
- pas de reformulation générique
- covered_angles doit refléter ce que la réponse couvre réellement
- signal_updates doit cibler prioritairement le fact_id de la question active si disponible
- remaining_angles doit rester réaliste et utile
- pas de texte hors JSON

CONTEXTE DE LA QUESTION ACTIVE
- dimension: ${dimension}
- iteration: ${iteration}
- fact_id: ${activeQuestion?.fact_id ?? "n/a"}
- theme: ${activeQuestion?.theme ?? activeFact?.theme ?? "n/a"}
- intended_angle: ${intendedAngle ?? "n/a"}
- question_posée: ${activeQuestion?.question ?? "n/a"}
- constat: ${activeQuestion?.constat ?? "n/a"}
- risque_managerial: ${activeQuestion?.risque_managerial ?? "n/a"}

ETAT ACTUEL DU SIGNAL
- observed_element: ${activeFact?.observed_element ?? "n/a"}
- source_excerpt: ${activeFact?.source_excerpt ?? "n/a"}
- numeric_values: ${activeFact?.numeric_values ? JSON.stringify(activeFact.numeric_values) : "n/a"}
- progress: ${activeFact?.progress ?? "n/a"}
- asked_angles: ${(activeFact?.asked_angles ?? []).join(" | ") || "aucun"}
- missing_angles: ${(activeFact?.missing_angles ?? []).join(" | ") || "aucun"}
- previous_questions: ${((activeFact as any)?.previous_questions ?? []).join(" | ") || "aucune"}
- previous_answers: ${((activeFact as any)?.previous_answers ?? []).join(" | ") || "aucune"}
- answer_summaries: ${((activeFact as any)?.answer_summaries ?? []).join(" | ") || "aucun"}
- validated_findings_fact: ${((activeFact as any)?.validated_findings ?? []).join(" | ") || "aucun"}
- open_hypotheses_fact: ${((activeFact as any)?.open_hypotheses ?? []).join(" | ") || "aucune"}

Historique :
${history}

Contexte trame :
${extractedText.slice(0, 12000)}

Réponse du dirigeant :
${userMessage}

Mémoire actuelle :
signals: ${bucket.signals.join(" | ") || "Aucun"}
evidences: ${bucket.evidences.join(" | ") || "Aucune"}
validated_findings: ${bucket.validated_findings.join(" | ") || "Aucun"}
open_hypotheses: ${bucket.open_hypotheses.join(" | ") || "Aucune"}
critical_uncovered_themes: ${bucket.critical_uncovered_themes.join(" | ") || "Aucun"}

Patterns historiques utiles :
${knowledgeSnippet}
`.trim();

  try {
    const resp = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL_CHAT || "gpt-4o-mini",
      temperature: 0.05,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Consultant senior en redressement de PME. Analyse structurée JSON uniquement.",
        },
        { role: "user", content: prompt },
      ],
    });

    const raw = resp.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);

    const coveredAngles = Array.isArray(parsed?.covered_angles)
      ? (parsed.covered_angles
          .map((x: unknown) => normalizeAngle(String(x ?? "")))
          .filter(Boolean) as SignalAngle[])
      : [];

    const signalUpdates = Array.isArray(parsed?.signal_updates)
      ? parsed.signal_updates
          .map((x: any) => {
            const factId = String(x?.fact_id ?? "").trim();
            const progress =
              normalizeProgress(String(x?.progress ?? "").trim()) ?? undefined;

            const newlyCoveredAngles = Array.isArray(x?.newly_covered_angles)
              ? x.newly_covered_angles
                  .map((a: unknown) => normalizeAngle(String(a ?? "")))
                  .filter(Boolean)
              : [];

            const remainingAngles = Array.isArray(x?.remaining_angles)
              ? x.remaining_angles
                  .map((a: unknown) => normalizeAngle(String(a ?? "")))
                  .filter(Boolean)
              : [];

            if (!factId) return null;

            return {
              fact_id: factId,
              progress,
              newly_covered_angles: limitUniqueAngles(
                newlyCoveredAngles as SignalAngle[],
                6
              ),
              remaining_angles: limitUniqueAngles(
                remainingAngles as SignalAngle[],
                6
              ),
            };
          })
          .filter(Boolean)
      : [];

    const normalizedCoveredAngles = limitUniqueAngles(
      [...coveredAngles, ...inferredFallbackAngles],
      6
    );

    const fallbackSignalUpdates =
      signalUpdates.length === 0 && activeQuestion?.fact_id
        ? [
            {
              fact_id: activeQuestion.fact_id,
              progress: undefined,
              newly_covered_angles: normalizedCoveredAngles,
              remaining_angles: [],
            },
          ]
        : signalUpdates;

    return {
      new_signals: Array.isArray(parsed?.new_signals)
        ? parsed.new_signals.map(String).filter(Boolean).slice(0, 4)
        : [],
      new_evidences: Array.isArray(parsed?.new_evidences)
        ? parsed.new_evidences.map(String).filter(Boolean).slice(0, 4)
        : [],
      validated_findings: Array.isArray(parsed?.validated_findings)
        ? parsed.validated_findings.map(String).filter(Boolean).slice(0, 2)
        : [],
      open_hypotheses: Array.isArray(parsed?.open_hypotheses)
        ? parsed.open_hypotheses.map(String).filter(Boolean).slice(0, 2)
        : [],
      resolved_topics: Array.isArray(parsed?.resolved_topics)
        ? parsed.resolved_topics.map(String).filter(Boolean).slice(0, 2)
        : [],
      contradictions: Array.isArray(parsed?.contradictions)
        ? parsed.contradictions.map(String).filter(Boolean).slice(0, 2)
        : [],
      covered_themes: Array.isArray(parsed?.covered_themes)
        ? parsed.covered_themes.map(String).filter(Boolean).slice(0, 4)
        : [],
      theme_status_updates: Array.isArray(parsed?.theme_status_updates)
        ? parsed.theme_status_updates
            .map((x: any) => ({
              theme: String(x?.theme ?? "").trim(),
              status: String(x?.status ?? "").trim() as
                | "unseen"
                | "exploring"
                | "covered"
                | "resolved",
            }))
            .filter(
              (x: { theme: string; status: string }) =>
                Boolean(x.theme) &&
                ["unseen", "exploring", "covered", "resolved"].includes(x.status)
            )
            .slice(0, 6)
        : [],
      next_best_angle: String(parsed?.next_best_angle ?? "").trim(),
      confidence_score: Math.max(
        0,
        Math.min(100, Number(parsed?.confidence_score ?? 0))
      ),
      covered_angles: normalizedCoveredAngles,
      signal_updates: fallbackSignalUpdates as AnalysisStep["signal_updates"],
    };
  } catch {
    return null;
  }
}

async function resolveFactsFromAnswer(params: {
  extractedText: string;
  dimension: number;
  iteration: number;
  history: string;
  userMessage: string;
  coverage: CoverageState;
  activeQuestion?: FactBackedQuestion | null;
  knowledgeBase: KnowledgeBase;
}): Promise<{
  coverage: CoverageState;
  analysis: AnalysisStep;
}> {
  const {
    extractedText,
    dimension,
    iteration,
    history,
    userMessage,
    coverage,
    activeQuestion,
    knowledgeBase,
  } = params;

  const analysis =
    (await analyzeUserAnswer({
      extractedText,
      dimension,
      iteration,
      history,
      userMessage,
      coverage,
      activeQuestion,
      knowledgeBase,
    })) ?? buildAnalysisFallback();

  const next = updateCoverageWithAnalysis(coverage, dimension, analysis);

  if (activeQuestion?.fact_id) {
    const fact = next.fact_inventory.find((f) => f.id === activeQuestion.fact_id);

    if (fact) {
      const mutableFact = fact as any;

      if (!Array.isArray(mutableFact.previous_questions)) {
        mutableFact.previous_questions = [];
      }

      if (!Array.isArray(mutableFact.previous_answers)) {
        mutableFact.previous_answers = [];
      }

      if (!Array.isArray(mutableFact.answer_summaries)) {
        mutableFact.answer_summaries = [];
      }

      if (!Array.isArray(mutableFact.validated_findings)) {
        mutableFact.validated_findings = [];
      }

      if (!Array.isArray(mutableFact.open_hypotheses)) {
        mutableFact.open_hypotheses = [];
      }

      if (!Array.isArray(mutableFact.next_question_hints)) {
        mutableFact.next_question_hints = [];
      }

      const activeQuestionText = String(activeQuestion.question || "").trim();
      const userAnswerText = String(userMessage || "").trim();

      if (
        activeQuestionText &&
        !mutableFact.previous_questions.some(
          (q: string) =>
            String(q || "").trim().toLowerCase() ===
            activeQuestionText.toLowerCase()
        )
      ) {
        mutableFact.previous_questions.push(activeQuestionText);
      }

      if (
        userAnswerText &&
        !mutableFact.previous_answers.some(
          (a: string) =>
            String(a || "").trim().toLowerCase() ===
            userAnswerText.toLowerCase()
        )
      ) {
        mutableFact.previous_answers.push(userAnswerText);
      }

      const summaryParts: string[] = [];

      if (analysis.validated_findings.length > 0) {
        summaryParts.push(...analysis.validated_findings);
      }

      if (analysis.new_evidences.length > 0) {
        summaryParts.push(...analysis.new_evidences);
      }

      if (analysis.open_hypotheses.length > 0) {
        summaryParts.push(
          ...analysis.open_hypotheses.map((h) => `Hypothèse ouverte : ${h}`)
        );
      }

      const answerSummary =
        summaryParts.length > 0
          ? summaryParts.slice(0, 3).join(" / ")
          : userAnswerText.slice(0, 280);

      if (
        answerSummary &&
        !mutableFact.answer_summaries.some(
          (s: string) =>
            String(s || "").trim().toLowerCase() ===
            answerSummary.toLowerCase()
        )
      ) {
        mutableFact.answer_summaries.push(answerSummary);
      }

      if (analysis.validated_findings.length > 0) {
        mutableFact.validated_findings = Array.from(
          new Set([
            ...mutableFact.validated_findings,
            ...analysis.validated_findings,
          ])
        ).slice(-10);
      }

      if (analysis.open_hypotheses.length > 0) {
        mutableFact.open_hypotheses = Array.from(
          new Set([...mutableFact.open_hypotheses, ...analysis.open_hypotheses])
        ).slice(-10);
      }

      if (analysis.next_best_angle) {
        mutableFact.next_question_hints.push(
          `Approfondir l’angle suivant : ${analysis.next_best_angle}`
        );
      }

      if (analysis.covered_angles && analysis.covered_angles.length > 0) {
        mutableFact.next_question_hints.push(
          `Angles déjà couverts : ${analysis.covered_angles.join(", ")}`
        );
      }

      mutableFact.previous_questions = mutableFact.previous_questions.slice(-10);
      mutableFact.previous_answers = mutableFact.previous_answers.slice(-10);
      mutableFact.answer_summaries = mutableFact.answer_summaries.slice(-10);
      mutableFact.validated_findings = mutableFact.validated_findings.slice(-10);
      mutableFact.open_hypotheses = mutableFact.open_hypotheses.slice(-10);
      mutableFact.next_question_hints = mutableFact.next_question_hints.slice(-10);

      if (analysis.validated_findings.length > 0) {
        fact.reasoning_status = "supported";
        fact.confidence_score = Math.min(
          100,
          (fact.confidence_score || 0) + 20
        );
      } else if (analysis.new_evidences.length > 0) {
        fact.reasoning_status = "partially_supported";
        fact.confidence_score = Math.min(
          100,
          (fact.confidence_score || 0) + 10
        );
      }

      fact.evidence_refs = Array.from(
        new Set([...(fact.evidence_refs || []), ...analysis.new_evidences])
      ).slice(0, 12);

      if (analysis.contradictions.length > 0) {
        fact.contradiction_notes = Array.from(
          new Set([
            ...(fact.contradiction_notes || []),
            ...analysis.contradictions,
          ])
        ).slice(0, 8);
      }
    }
  }

  return {
    coverage: refreshDimensionMemory(next, dimension),
    analysis,
  };
}

function buildIterationValidationMessage(
  dimension: number,
  iteration: number,
  coverage: CoverageState
) {
  const bucket =
    coverage.dimensions[toDimensionKey(dimension)] ?? defaultBucket(dimension);

  const score = Math.round(bucket.sufficiency_score);

  return `Parfait.

Itération ${iteration}/3 traitée sur la dimension "${dimensionName(
    dimension
  )}".

Niveau de couverture estimé : ${score}/100.

Validez-vous que nous pouvons clôturer l’itération ${iteration}/3 de la dimension "${dimensionName(
    dimension
  )}" ? (oui/non)`;
}

function buildIterationMessage(
  dimension: number,
  iteration: number,
  mode: IterationMode,
  themes: string[]
) {
  const name = dimensionName(dimension);
  const title = iterationTitle(dimension, iteration);

  const themesBlock =
    themes.length > 0
      ? `\n\nPoints prioritairement explorés :\n${themes
          .slice(0, 6)
          .map((t, i) => `${i + 1}. ${t}`)
          .join("\n")}`
      : "";

  if (mode === "reopen_after_no") {
    return `Dimension ${dimension} — ${name}
Itération ${iteration}/3 — ${title}

Certains points restent insuffisamment étayés. Voici une relance ciblée.${themesBlock}`;
  }

  return `Dimension ${dimension} — ${name}
Itération ${iteration}/3 — ${title}${themesBlock}`;
}

function buildDimensionTransitionMessage(nextDimension: number) {
  return `La dimension précédente est validée.

Nous passons maintenant à la dimension ${nextDimension} — ${dimensionName(
    nextDimension
  )}.`;
}

function buildAssistantResponse(
  assistantMessage: string,
  batch: FactBackedQuestion[],
  needsValidation: boolean
): AssistantJSON {
  return {
    assistant_message: assistantMessage,
    questions: convertBatchToStructuredQuestions(batch),
    needs_validation: needsValidation,
  };
}

function normalizeFinalObjectiveSet(raw: unknown): FinalObjectiveSet | null {
  if (!raw || typeof raw !== "object") return null;

  const source = raw as any;
  const objectives = Array.isArray(source.objectives)
    ? source.objectives
    : Array.isArray(raw)
    ? raw
    : [];

  const normalizedObjectives = objectives
    .map((o: any, index: number): FinalObjective => {
      const dimensionId = Number(o?.dimensionId ?? o?.dimension ?? index + 1) || 1;

      return {
        id: String(o?.id ?? `obj-${dimensionId}-${index + 1}`),
        dimensionId,
        objectiveLabel: String(
          o?.objectiveLabel ?? o?.objectif ?? o?.label ?? ""
        ).trim(),
        owner: String(o?.owner ?? o?.responsable ?? "Direction agence").trim(),
        keyIndicator: String(
          o?.keyIndicator ?? o?.indicateur ?? "Indicateur à préciser"
        ).trim(),
        dueDate: String(o?.dueDate ?? o?.echeance ?? "90 jours").trim(),
        potentialGain: String(
          o?.potentialGain ?? o?.gain_potentiel ?? "Gain à chiffrer"
        ).trim(),
        gainHypotheses: Array.isArray(o?.gainHypotheses)
          ? o.gainHypotheses.map(String).filter(Boolean)
          : Array.isArray(o?.hypotheses)
          ? o.hypotheses.map(String).filter(Boolean)
          : [],
        validationStatus:
          o?.validationStatus === "validated" ||
          o?.validationStatus === "adjusted" ||
          o?.validationStatus === "refused" ||
          o?.validationStatus === "proposed"
            ? o.validationStatus
            : "proposed",
        quickWin: String(
          o?.quickWin ?? o?.quick_win ?? "Action rapide à cadrer"
        ).trim(),
      };
    })
    .filter((o: FinalObjective) => Boolean(o.objectiveLabel));

  if (normalizedObjectives.length === 0) return null;

  return {
    header:
      String(source.header ?? "").trim() ||
      "Objectifs finaux proposés à partir des dimensions consolidées.",
    objectives: normalizedObjectives,
    decisionsCapturedAt:
      typeof source.decisionsCapturedAt === "string"
        ? source.decisionsCapturedAt
        : undefined,
  };
}

function objectiveLabelFromDimension(dimension: DiagnosticDimensionResult): string {
  const firstConstat = dimension.constats_cles?.[0] || "";
  const firstZone = dimension.zones_non_pilotees?.[0] || "";

  if (firstZone) {
    return `Sécuriser le pilotage de la zone suivante : ${firstZone}`;
  }

  if (firstConstat) {
    return `Transformer le constat prioritaire en plan de maîtrise : ${firstConstat}`;
  }

  return `Structurer le plan de maîtrise de la dimension ${dimension.dimension} — ${dimension.name}`;
}

function keyIndicatorFromDimension(dimension: DiagnosticDimensionResult): string {
  const zone = dimension.zones_non_pilotees?.[0] || "";

  if (zone.toLowerCase().includes("marge")) {
    return "Écart marge prévue / marge réalisée suivi chaque semaine";
  }

  if (zone.toLowerCase().includes("charge") || zone.toLowerCase().includes("capacité")) {
    return "Taux d’adéquation charge / capacité mis à jour chaque semaine";
  }

  if (zone.toLowerCase().includes("commercial") || zone.toLowerCase().includes("pipeline")) {
    return "Pipeline qualifié, pondéré et revu hebdomadairement";
  }

  if (zone.toLowerCase().includes("rôle") || zone.toLowerCase().includes("responsabilité")) {
    return "Responsabilités clarifiées et arbitrages tracés";
  }

  return "Indicateur de maîtrise défini et suivi mensuellement";
}

function potentialGainFromDimension(dimension: DiagnosticDimensionResult): string {
  const text = [
    ...(dimension.constats_cles || []),
    ...(dimension.zones_non_pilotees || []),
    ...(dimension.evidences || []),
    ...(dimension.signals || []),
  ]
    .join(" ")
    .toLowerCase();

  if (text.includes("marge") || text.includes("ebitda") || text.includes("rentabilité")) {
    return "Amélioration potentielle de marge à chiffrer sur les affaires prioritaires";
  }

  if (text.includes("retard") || text.includes("facturation")) {
    return "Réduction du retard de facturation et amélioration du cash opérationnel";
  }

  if (text.includes("charge") || text.includes("heures") || text.includes("productivité")) {
    return "Gain de productivité à chiffrer via le suivi charge / capacité";
  }

  return "Gain économique à quantifier lors du cadrage du plan d’actions";
}

function buildDeterministicFinalObjectives(
  diagnosticResult: DiagnosticResult
): FinalObjectiveSet {
  const dimensions = diagnosticResult.dimensions
    .filter((d) => d && Number(d.dimension) >= 1 && Number(d.dimension) <= 4)
    .sort((a, b) => a.dimension - b.dimension);

  const objectives = dimensions.map((dimension, index): FinalObjective => ({
    id: `obj-d${dimension.dimension}-${index + 1}`,
    dimensionId: dimension.dimension,
    objectiveLabel: objectiveLabelFromDimension(dimension),
    owner: "Direction agence",
    keyIndicator: keyIndicatorFromDimension(dimension),
    dueDate: "90 jours",
    potentialGain: potentialGainFromDimension(dimension),
    gainHypotheses: [
      "Hypothèse à confirmer avec les données économiques disponibles.",
      "Gain à sécuriser par un responsable nommé et un suivi périodique.",
    ],
    validationStatus: "proposed",
    quickWin:
      dimension.zones_non_pilotees?.[0]
        ? `Mettre sous revue hebdomadaire : ${dimension.zones_non_pilotees[0]}`
        : "Désigner un responsable et un indicateur de pilotage.",
  }));

  return {
    header:
      "Voici les objectifs finaux proposés à partir des quatre dimensions consolidées. Vous pouvez les valider globalement ou demander un ajustement.",
    objectives,
  };
}

function hasUsableObjectives(raw: unknown): boolean {
  const normalized = normalizeFinalObjectiveSet(raw);
  return Boolean(normalized && normalized.objectives.length > 0);
}

function buildFinalObjectivesValidationMessage(objectives: FinalObjectiveSet): string {
  const lines = objectives.objectives.map((objective, index) => {
    return `${index + 1}. Dimension ${objective.dimensionId} — ${objective.objectiveLabel}
   Indicateur : ${objective.keyIndicator}
   Responsable : ${objective.owner}
   Échéance : ${objective.dueDate}
   Gain potentiel : ${objective.potentialGain}`;
  });

  return `${objectives.header}

${lines.join("\n\n")}

Validez-vous ces objectifs finaux ? Répondez "oui" pour les valider, ou indiquez les ajustements souhaités objectif par objectif.`;
}

function applyObjectiveValidation(
  raw: unknown,
  message: string
): FinalObjectiveSet {
  const normalized =
    normalizeFinalObjectiveSet(raw) ??
    ({
      header: "Objectifs finaux proposés.",
      objectives: [],
    } as FinalObjectiveSet);

  const now = new Date().toISOString();

  if (isYes(message)) {
    return {
      ...normalized,
      decisionsCapturedAt: now,
      objectives: normalized.objectives.map((objective) => ({
        ...objective,
        validationStatus: "validated",
      })),
    };
  }

  return {
    ...normalized,
    decisionsCapturedAt: now,
    header: `${normalized.header}

Ajustement demandé par le dirigeant : ${message}`,
    objectives: normalized.objectives.map((objective) => ({
      ...objective,
      validationStatus: "adjusted",
    })),
  };
}

export async function runDiagnosticEngine(
  sessionId: string,
  userId: string,
  message: string
): Promise<AssistantJSON> {
  const admin = adminSupabase();

  const { data: session, error: sessionErr } = await admin
    .from("diagnostic_sessions")
    .select(
      "id, extracted_text, dimension, iteration, status, phase, coverage_json, global_analysis_json, diagnostic_result_json, final_objectives_json, question_batch_json, question_index, consolidation_json"
    )
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionErr) throw new Error(sessionErr.message);
  if (!session) throw new Error("Session not found");
  if (!session.extracted_text) throw new Error("TRAME_NOT_INGESTED");

  const extractedText = String(session.extracted_text);

  const knowledgeBase = await loadKnowledgeBaseForUser(userId);

  const s = session as SessionRow;
  const dimension = clampDimension(s.dimension ?? 1);
  const iteration = clampIteration(s.iteration ?? 1);
  const status = s.status ?? "in_progress";
  const phase = s.phase ?? "dimension_questions";

  let coverage: CoverageState = normalizeCoverage(s.coverage_json);

  if (!coverage.global_analysis && s.global_analysis_json) {
    coverage.global_analysis = normalizeGlobalAnalysis(s.global_analysis_json);
  }

  coverage = await ensureGlobalAnalysis(coverage, extractedText);
  coverage = await ensureFactInventory(coverage, extractedText);
  coverage = refreshDimensionMemory(coverage, dimension);

  let diagnosticResult: DiagnosticResult = normalizeDiagnosticResult(
    s.diagnostic_result_json
  );

  diagnosticResult.synthesis = computeDiagnosticSynthesis(
    diagnosticResult,
    coverage.global_analysis
  );

  const batch: FactBackedQuestion[] = normalizeQuestionBatch(
    s.question_batch_json
  );
  const questionIndex = Math.max(Number(s.question_index ?? 0), 0);

  await admin
    .from("diagnostic_sessions")
    .update({
      coverage_json: coverage,
      global_analysis_json: coverage.global_analysis,
      diagnostic_result_json: diagnosticResult,
    })
    .eq("id", sessionId);

  debugLog("runDiagnosticEngine_entry", {
    sessionId,
    dimension,
    iteration,
    phase,
    status,
    incomingMessage: message,
    currentBatchSize: batch.length,
    currentQuestionIndex: questionIndex,
  });

  const normalizedMessage = String(message ?? "").trim();

  if (phase === "final_objectives_validation") {
    const existingObjectives =
      normalizeFinalObjectiveSet(s.final_objectives_json) ??
      buildDeterministicFinalObjectives(diagnosticResult);

    if (!normalizedMessage) {
      await admin
        .from("diagnostic_sessions")
        .update({
          status: "in_progress",
          phase: "final_objectives_validation",
          final_objectives_json: existingObjectives,
          question_batch_json: [],
          question_index: 0,
          coverage_json: coverage,
          global_analysis_json: coverage.global_analysis,
          diagnostic_result_json: diagnosticResult,
        })
        .eq("id", sessionId);

      return {
        assistant_message: buildFinalObjectivesValidationMessage(existingObjectives),
        questions: [],
        needs_validation: true,
      };
    }

    const validatedObjectives = applyObjectiveValidation(
      existingObjectives,
      normalizedMessage
    );

    if (!hasUsableObjectives(validatedObjectives)) {
      return {
        assistant_message:
          "Les objectifs finaux ne sont pas exploitables. Merci de préciser au moins un objectif opérationnel, un indicateur et un responsable.",
        questions: [],
        needs_validation: true,
      };
    }

    await admin
      .from("diagnostic_sessions")
      .update({
        status: "report_ready",
        phase: "report_ready",
        final_objectives_json: validatedObjectives,
        question_batch_json: [],
        question_index: 0,
        coverage_json: coverage,
        global_analysis_json: coverage.global_analysis,
        diagnostic_result_json: diagnosticResult,
      })
      .eq("id", sessionId);

    return {
      assistant_message:
        "Les objectifs finaux sont validés. Le diagnostic est prêt pour la construction du rapport dirigeant.",
      questions: [],
      needs_validation: false,
    };
  }

  if (
    status === "completed" ||
    phase === "completed" ||
    phase === "diagnostic_complete" ||
    phase === "report_ready"
  ) {
    if (!hasUsableObjectives(s.final_objectives_json)) {
      const objectives = buildDeterministicFinalObjectives(diagnosticResult);

      await admin
        .from("diagnostic_sessions")
        .update({
          status: "in_progress",
          phase: "final_objectives_validation",
          final_objectives_json: objectives,
          question_batch_json: [],
          question_index: 0,
          coverage_json: coverage,
          global_analysis_json: coverage.global_analysis,
          diagnostic_result_json: diagnosticResult,
        })
        .eq("id", sessionId);

      return {
        assistant_message: buildFinalObjectivesValidationMessage(objectives),
        questions: [],
        needs_validation: true,
      };
    }

    return {
      assistant_message:
        "Le diagnostic conversationnel est terminé. La prochaine étape est la génération du rapport final.",
      questions: [],
      needs_validation: false,
    };
  }

  const { data: events, error: eventsErr } = await admin
    .from("diagnostic_events")
    .select("kind,payload,created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .limit(600);

  if (eventsErr) throw new Error(eventsErr.message);

  const history = buildHistory(
    (events ?? []) as Array<{ kind?: string; payload?: any }>
  );

  if (phase === "iteration_validation") {
    if (isYes(normalizedMessage)) {
      if (iteration >= 3) {
        diagnosticResult = await consolidateDimensionResult({
          coverage,
          diagnosticResult,
          extractedText,
          dimension,
        });

        if (dimension >= 4) {
          const objectives =
            normalizeFinalObjectiveSet(s.final_objectives_json) ??
            buildDeterministicFinalObjectives(diagnosticResult);

          await admin
            .from("diagnostic_sessions")
            .update({
              phase: "final_objectives_validation",
              status: "in_progress",
              coverage_json: coverage,
              global_analysis_json: coverage.global_analysis,
              diagnostic_result_json: diagnosticResult,
              final_objectives_json: objectives,
              question_batch_json: [],
              question_index: 0,
            })
            .eq("id", sessionId);

          return {
            assistant_message: buildFinalObjectivesValidationMessage(objectives),
            questions: [],
            needs_validation: true,
          };
        }

        const nextDimension = clampDimension(dimension + 1);
        const nextIteration = 1;

        coverage = refreshDimensionMemory(coverage, nextDimension);

        const nextBatch: FactBackedQuestion[] = await buildQuestionBatch({
          extractedText,
          coverage,
          dimension: nextDimension,
          iteration: nextIteration,
          history,
          mode: "normal",
        });

        await admin
          .from("diagnostic_sessions")
          .update({
            dimension: nextDimension,
            iteration: nextIteration,
            status: "in_progress",
            phase: "dimension_questions",
            question_batch_json: nextBatch,
            question_index: 0,
            coverage_json: coverage,
            global_analysis_json: coverage.global_analysis,
            diagnostic_result_json: diagnosticResult,
          })
          .eq("id", sessionId);

        return buildAssistantResponse(
          `${buildDimensionTransitionMessage(nextDimension)}

${buildIterationMessage(
  nextDimension,
  nextIteration,
  "normal",
  extractThemes(nextBatch)
)}`,
          nextBatch,
          false
        );
      }

      const nextIteration = clampIteration(iteration + 1);

      const nextBatch: FactBackedQuestion[] = await buildQuestionBatch({
        extractedText,
        coverage,
        dimension,
        iteration: nextIteration,
        history,
        mode: "normal",
      });

      await admin
        .from("diagnostic_sessions")
        .update({
          iteration: nextIteration,
          phase: "dimension_questions",
          question_batch_json: nextBatch,
          question_index: 0,
          coverage_json: coverage,
          global_analysis_json: coverage.global_analysis,
          diagnostic_result_json: diagnosticResult,
        })
        .eq("id", sessionId);

      return buildAssistantResponse(
        buildIterationMessage(
          dimension,
          nextIteration,
          "normal",
          extractThemes(nextBatch)
        ),
        nextBatch,
        false
      );
    }

    if (isNo(normalizedMessage)) {
      const relaunchBatch: FactBackedQuestion[] = await buildQuestionBatch({
        extractedText,
        coverage,
        dimension,
        iteration,
        history,
        mode: "reopen_after_no",
      });

      await admin
        .from("diagnostic_sessions")
        .update({
          phase: "dimension_questions",
          question_batch_json: relaunchBatch,
          question_index: 0,
          coverage_json: coverage,
          global_analysis_json: coverage.global_analysis,
          diagnostic_result_json: diagnosticResult,
        })
        .eq("id", sessionId);

      return buildAssistantResponse(
        buildIterationMessage(
          dimension,
          iteration,
          "reopen_after_no",
          extractThemes(relaunchBatch)
        ),
        relaunchBatch,
        false
      );
    }

    return {
      assistant_message:
        'Merci de répondre uniquement par "oui" ou "non" pour valider l’itération en cours.',
      questions: [],
      needs_validation: true,
    };
  }

  if (phase === "dimension_questions") {
    let safeBatch: FactBackedQuestion[] = batch;

    if (!hasExpectedBatchSize(batch, iteration, "normal")) {
      const rebuiltBatch: FactBackedQuestion[] = await buildQuestionBatch({
        extractedText,
        coverage,
        dimension,
        iteration,
        history,
        mode: "normal",
      });

      await admin
        .from("diagnostic_sessions")
        .update({
          phase: "dimension_questions",
          question_batch_json: rebuiltBatch,
          question_index: 0,
          coverage_json: coverage,
          global_analysis_json: coverage.global_analysis,
          diagnostic_result_json: diagnosticResult,
        })
        .eq("id", sessionId);

      return buildAssistantResponse(
        buildIterationMessage(
          dimension,
          iteration,
          "normal",
          extractThemes(rebuiltBatch)
        ),
        rebuiltBatch,
        false
      );
    }

    safeBatch = batch;

    if (safeBatch.length > 0 && questionIndex < safeBatch.length && normalizedMessage) {
      const activeQuestion = safeBatch[questionIndex] ?? null;

      const resolved = await resolveFactsFromAnswer({
        extractedText,
        dimension,
        iteration,
        history,
        userMessage: normalizedMessage,
        coverage,
        activeQuestion,
        knowledgeBase,
      });

      coverage = resolved.coverage;
      const analysis = resolved.analysis;

      if (activeQuestion) {
        coverage = registerConsumedQuestion({
          coverage,
          dimension,
          iteration,
          question: activeQuestion,
        });
      }

      const questionAnswerPayload: Record<string, unknown> = {
        session_id: sessionId,
        kind: "QUESTION_ANSWER",
        payload: {
          dimension,
          iteration,
          question_index: questionIndex,
          question: activeQuestion,
          answer: normalizedMessage,
          analysis,
          fact_id: activeQuestion?.fact_id ?? null,
          intended_angle: activeQuestion?.intended_angle ?? null,
        },
      };

      if (isUuid(userId)) {
        questionAnswerPayload.user_id = userId;
      }

      await admin.from("diagnostic_events").insert(questionAnswerPayload);

      const nextIndex = questionIndex + 1;

      if (nextIndex >= safeBatch.length) {
        await admin
          .from("diagnostic_sessions")
          .update({
            question_index: nextIndex,
            phase: "iteration_validation",
            coverage_json: coverage,
            global_analysis_json: coverage.global_analysis,
            diagnostic_result_json: diagnosticResult,
            question_batch_json: safeBatch,
          })
          .eq("id", sessionId);

        return {
          assistant_message: buildIterationValidationMessage(
            dimension,
            iteration,
            coverage
          ),
          questions: [],
          needs_validation: true,
        };
      }

      await admin
        .from("diagnostic_sessions")
        .update({
          question_index: nextIndex,
          phase: "dimension_questions",
          coverage_json: coverage,
          global_analysis_json: coverage.global_analysis,
          diagnostic_result_json: diagnosticResult,
          question_batch_json: safeBatch,
        })
        .eq("id", sessionId);

      return buildAssistantResponse("", safeBatch, false);
    }

    if (safeBatch.length > 0 && questionIndex < safeBatch.length) {
      return buildAssistantResponse(
        buildIterationMessage(
          dimension,
          iteration,
          "normal",
          extractThemes(safeBatch)
        ),
        safeBatch,
        false
      );
    }

    const regeneratedBatch: FactBackedQuestion[] = await buildQuestionBatch({
      extractedText,
      coverage,
      dimension,
      iteration,
      history,
      mode: "normal",
    });

    await admin
      .from("diagnostic_sessions")
      .update({
        phase: "dimension_questions",
        question_batch_json: regeneratedBatch,
        question_index: 0,
        coverage_json: coverage,
        global_analysis_json: coverage.global_analysis,
        diagnostic_result_json: diagnosticResult,
      })
      .eq("id", sessionId);

    return buildAssistantResponse(
      buildIterationMessage(
        dimension,
        iteration,
        "normal",
        extractThemes(regeneratedBatch)
      ),
      regeneratedBatch,
      false
    );
  }

  return {
    assistant_message:
      "État de diagnostic non reconnu. Merci de relancer la session.",
    questions: [],
    needs_validation: false,
  };
}