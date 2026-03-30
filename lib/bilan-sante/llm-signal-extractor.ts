// lib/bilan-sante/llm-signal-extractor.ts

import OpenAI from "openai";
import {
  DIAGNOSTIC_DIMENSIONS,
  dimensionTitle,
  type DimensionId,
} from "@/lib/bilan-sante/protocol";
import type { BaseTrameSnapshot } from "@/lib/bilan-sante/session-model";
import {
  clampScore,
  isEvidenceNature,
  isSignalEntryAngle,
  isUncoveredThemeReason,
  normalizeExtractionText,
  type LlmExtractedExplicitSignal,
  type LlmSignalExtractionResponse,
  type LlmUncoveredTheme,
} from "@/lib/bilan-sante/signal-extraction-contract";

type TrameSection = BaseTrameSnapshot["sections"][number];
type MissingField = BaseTrameSnapshot["missingFields"][number];

let cachedClient: OpenAI | null = null;

const LOG_PREFIX = "[BilanSante][LlmSignalExtractor]";

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

function getClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (!cachedClient) cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}

function llmModel(): string {
  return process.env.OPENAI_MODEL_CHAT || "gpt-4o-mini";
}

function truncate(text: string, max = 1600): string {
  const clean = normalizeExtractionText(text);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trim()}…`;
}

function safeArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function compactJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function serializeSections(sections: TrameSection[]): string {
  if (sections.length === 0) return "[]";
  return JSON.stringify(
    sections.map((section) => ({
      id: String(section.id ?? "").trim(),
      heading: normalizeExtractionText(section.heading),
      content: truncate(String(section.content ?? ""), 1800),
    })),
    null,
    2
  );
}

function serializeMissingFields(fields: MissingField[]): string {
  if (fields.length === 0) return "[]";
  return JSON.stringify(
    fields.map((field) => ({
      label: normalizeExtractionText(field.label),
      sourceText: truncate(String(field.sourceText ?? ""), 500),
      dimensionId: field.dimensionId,
    })),
    null,
    2
  );
}

function buildPrompt(params: { dimensionId: DimensionId; snapshot: BaseTrameSnapshot }): string {
  const dimension = DIAGNOSTIC_DIMENSIONS.find((item) => item.id === params.dimensionId);
  const allowedThemes = dimension?.requiredThemes ?? [];
  const relevantMissingFields = safeArray(params.snapshot.missingFields).filter(
    (field) => field.dimensionId === params.dimensionId
  );

  return [
    "Tu es un consultant senior en diagnostic dirigeant de PME.",
    "Tu dois extraire uniquement des signaux fiables à partir de la trame fournie.",
    "Tu n'inventes aucun fait.",
    "Tu ne peux utiliser QUE les thèmes autorisés.",
    "",
    "Règle clé : ne pas exiger un libellé littéral du thème pour accepter un signal.",
    "Des indices convergents, cohérents et managérialement exploitables suffisent si le texte décrit clairement :",
    "- un processus réel,",
    "- une pratique récurrente,",
    "- une dépendance au dirigeant ou à un acteur clé,",
    "- une faiblesse durable de pilotage,",
    "- un arbitrage, une organisation, une tension de charge ou un besoin de recrutement / remplacement / montée en compétence.",
    "",
    "Un simple voisinage lexical ne suffit pas.",
    "Mais un signal indirect convergent est recevable si la matière métier pointe clairement vers le thème.",
    "Exemples acceptables :",
    "- départs, remplacements, difficultés de recrutement, intégration ou fidélisation => peuvent couvrir 'recrutement et intégration'",
    "- rôle du dirigeant, plan de conquête, animation commerciale, déclinaison opérationnelle => peuvent couvrir 'portage managérial et déploiement réel'",
    "- critères de sélection, pipe, qualification, taux de réussite => peuvent couvrir 'indicateurs funnel / taux de succès'",
    "",
    "Quand la matière est faible mais exploitable, préfère produire un explicitSignal avec evidenceNature='illustrative' ou 'unclear' plutôt que classer trop vite le thème dans uncoveredThemes.",
    "Réserve uncoveredThemes aux cas où la matière est vraiment insuffisante ou trop ambiguë.",
    "",
    "Définitions obligatoires :",
    '- evidenceNature="structural" : preuve claire d’un fonctionnement durable, d’une faiblesse structurelle, d’une absence de pilotage, d’un arbitrage, d’une dépendance ou d’une pratique récurrente',
    '- evidenceNature="illustrative" : exemple convergent utile, insuffisant seul mais suffisamment relié au thème pour ouvrir une question robuste',
    '- evidenceNature="anecdotal" : cas ponctuel, récit isolé, matière non généralisable',
    '- evidenceNature="unclear" : matière ambiguë mais pouvant orienter une question utile',
    "",
    "Taxonomie fermée des entry angles :",
    '- "causality"',
    '- "arbitration"',
    '- "economics"',
    '- "formalization"',
    '- "dependency"',
    '- "mechanism"',
    "",
    "Format JSON STRICT attendu :",
    "{",
    '  "dimensionId": 1,',
    '  "explicitSignals": [',
    "    {",
    '      "theme": "string",',
    '      "sourceSectionId": "string",',
    '      "sourceExcerpt": "string",',
    '      "evidenceNature": "structural|illustrative|anecdotal|unclear",',
    '      "entryAngle": "causality|arbitration|economics|formalization|dependency|mechanism",',
    '      "relevanceScore": 0,',
    '      "confidenceScore": 0,',
    '      "criticalityScore": 0,',
    '      "constat": "string",',
    '      "managerialRisk": "string",',
    '      "probableConsequence": "string",',
    '      "whyRelevant": "string"',
    "    }",
    "  ],",
    '  "uncoveredThemes": [',
    "    {",
    '      "theme": "string",',
    '      "reason": "no_evidence|only_illustrative|only_anecdotal|too_weak|not_enough_material",',
    '      "confidenceScore": 0,',
    '      "whyMissing": "string"',
    "    }",
    "  ]",
    "}",
    "",
    "Règles impératives :",
    "- theme doit appartenir strictement à la liste autorisée",
    "- sourceSectionId doit correspondre à une section fournie",
    "- sourceExcerpt doit être extrait du texte, pas inventé",
    "- si un extrait est seulement partiellement convergent, tu peux quand même créer un explicitSignal si whyRelevant explique clairement le lien métier",
    "- ne bascule pas trop vite en uncoveredThemes",
    "- répondre STRICTEMENT en JSON, sans aucun texte hors JSON",
    "",
    `DIMENSION : ${params.dimensionId} — ${dimensionTitle(params.dimensionId)}`,
    `THEMES AUTORISÉS : ${JSON.stringify(allowedThemes)}`,
    "",
    "SECTIONS DE LA TRAME :",
    serializeSections(safeArray(params.snapshot.sections)),
    "",
    "MISSING FIELDS PERTINENTS :",
    serializeMissingFields(relevantMissingFields),
  ].join("\n");
}

function tryParseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function sanitizeExplicitSignals(params: {
  raw: unknown;
  allowedThemes: Set<string>;
  allowedSectionIds: Set<string>;
}): LlmExtractedExplicitSignal[] {
  if (!Array.isArray(params.raw)) return [];
  const out: LlmExtractedExplicitSignal[] = [];

  for (const item of params.raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const theme = normalizeExtractionText(row.theme);
    const sourceSectionId = normalizeExtractionText(row.sourceSectionId);
    const sourceExcerpt = normalizeExtractionText(row.sourceExcerpt);
    const evidenceNature = row.evidenceNature;
    const entryAngle = row.entryAngle;
    const constat = normalizeExtractionText(row.constat);
    const managerialRisk = normalizeExtractionText(row.managerialRisk);
    const probableConsequence = normalizeExtractionText(row.probableConsequence);
    const whyRelevant = normalizeExtractionText(row.whyRelevant);

    if (!theme || !params.allowedThemes.has(theme)) continue;
    if (!sourceSectionId || !params.allowedSectionIds.has(sourceSectionId)) continue;
    if (!sourceExcerpt || !constat || !managerialRisk || !probableConsequence) continue;
    if (!isEvidenceNature(evidenceNature)) continue;
    if (!isSignalEntryAngle(entryAngle)) continue;

    out.push({
      theme,
      sourceSectionId,
      sourceExcerpt,
      evidenceNature,
      entryAngle,
      relevanceScore: clampScore(row.relevanceScore, 0),
      confidenceScore: clampScore(row.confidenceScore, 0),
      criticalityScore: clampScore(row.criticalityScore, 0),
      constat,
      managerialRisk,
      probableConsequence,
      whyRelevant,
    });
  }

  return out;
}

function sanitizeUncoveredThemes(params: { raw: unknown; allowedThemes: Set<string> }): LlmUncoveredTheme[] {
  if (!Array.isArray(params.raw)) return [];
  const out: LlmUncoveredTheme[] = [];

  for (const item of params.raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const theme = normalizeExtractionText(row.theme);
    const reason = row.reason;
    const whyMissing = normalizeExtractionText(row.whyMissing);

    if (!theme || !params.allowedThemes.has(theme)) continue;
    if (!isUncoveredThemeReason(reason)) continue;

    out.push({
      theme,
      reason,
      confidenceScore: clampScore(row.confidenceScore, 0),
      whyMissing,
    });
  }

  return out;
}

function sanitizeResponse(params: {
  raw: unknown;
  dimensionId: DimensionId;
  snapshot: BaseTrameSnapshot;
}): LlmSignalExtractionResponse | null {
  if (!params.raw || typeof params.raw !== "object") return null;

  const dimension = DIAGNOSTIC_DIMENSIONS.find((item) => item.id === params.dimensionId);
  const allowedThemes = new Set<string>(dimension?.requiredThemes ?? []);
  const allowedSectionIds = new Set<string>(
    safeArray(params.snapshot.sections).map((section) => String(section.id ?? "").trim()).filter(Boolean)
  );

  const row = params.raw as Record<string, unknown>;

  return {
    dimensionId: params.dimensionId,
    explicitSignals: sanitizeExplicitSignals({
      raw: row.explicitSignals,
      allowedThemes,
      allowedSectionIds,
    }),
    uncoveredThemes: sanitizeUncoveredThemes({ raw: row.uncoveredThemes, allowedThemes }),
  };
}

export function llmSignalExtractionEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function extractSignalsForDimensionWithLlm(params: {
  snapshot: BaseTrameSnapshot;
  dimensionId: DimensionId;
}): Promise<LlmSignalExtractionResponse | null> {
  const client = getClient();

  logInfo("dimension_start", {
    dimensionId: params.dimensionId,
    model: llmModel(),
    hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
    sections: safeArray(params.snapshot.sections).length,
    missingFields: safeArray(params.snapshot.missingFields).filter((field) => field.dimensionId === params.dimensionId).length,
  });

  if (!client) {
    logWarn("dimension_skipped_no_api_key", { dimensionId: params.dimensionId, hasOpenAiKey: false });
    return null;
  }

  const prompt = buildPrompt(params);

  try {
    const response = await client.chat.completions.create({
      model: llmModel(),
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Tu extrais des signaux de diagnostic dirigeant. Tu n'inventes aucun fait. Tu n'es pas excessivement conservateur : des indices convergents peuvent justifier un signal explicite. Tu réponds strictement en JSON.",
        },
        { role: "user", content: prompt },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const parsed = tryParseJson(raw);
    const sanitized = sanitizeResponse({ raw: parsed, dimensionId: params.dimensionId, snapshot: params.snapshot });

    logInfo("dimension_completed", {
      dimensionId: params.dimensionId,
      rawChars: raw.length,
      parsedJson: Boolean(parsed),
      explicitSignalsSanitized: sanitized?.explicitSignals.length ?? 0,
      uncoveredThemesSanitized: sanitized?.uncoveredThemes.length ?? 0,
    });

    return sanitized ? compactJson(sanitized) : null;
  } catch (error) {
    logError("dimension_failed", {
      dimensionId: params.dimensionId,
      error: summarizeError(error),
    });
    return null;
  }
}
