// lib/bilan-sante/llm-dimension-consolidator.ts

import OpenAI from "openai";
import { dimensionTitle, type DimensionId } from "@/lib/bilan-sante/protocol";
import type {
  DiagnosticSignal,
  DimensionAnalysisSnapshot,
  DimensionFact,
  ObjectiveSeed,
  RootCauseHypothesis,
  SwotItem,
  SwotSnapshot,
  ZoneNonPilotee,
} from "@/lib/bilan-sante/session-model";

type LlmRefinementInput = {
  dimensionId: DimensionId;
  trameText?: string | null;
  facts: DimensionFact[];
  signals: DiagnosticSignal[];
  baseline: DimensionAnalysisSnapshot;
};

type ParsedRootCauseHypothesis = {
  label?: string;
  rationale?: string;
  confidenceScore?: number;
};

type ParsedSwotItem = {
  label?: string;
  rationale?: string;
};

type ParsedObjectiveSeed = {
  label?: string;
  indicator?: string;
  rationale?: string;
  suggestedDueDate?: string;
  potentialGain?: string;
  quickWin?: string;
};

type ParsedZone = {
  constat?: string;
  risqueManagerial?: string;
  consequence?: string;
};

type ParsedRefinementPayload = {
  summary?: string;
  keyFindings?: string[];
  rootCauseHypotheses?: ParsedRootCauseHypothesis[];
  swot?: {
    strengths?: ParsedSwotItem[];
    weaknesses?: ParsedSwotItem[];
    opportunities?: ParsedSwotItem[];
    threats?: ParsedSwotItem[];
  };
  objectiveSeeds?: ParsedObjectiveSeed[];
  nonPilotedAreas?: ParsedZone[];
};

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  if (!cachedClient) {
    cachedClient = new OpenAI({ apiKey });
  }

  return cachedClient;
}

function llmModel(): string {
  return process.env.OPENAI_MODEL_CHAT || "gpt-4o-mini";
}

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function truncate(text: string, max = 220): string {
  const clean = normalizeText(text);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trim()}…`;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function safeArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function compactJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function tryParseJson(raw: string): ParsedRefinementPayload | null {
  try {
    const parsed = JSON.parse(raw) as ParsedRefinementPayload;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function emptySwotSnapshot(): SwotSnapshot {
  return {
    strengths: [],
    weaknesses: [],
    opportunities: [],
    threats: [],
  };
}

function serializeFact(fact: DimensionFact): string {
  return [
    `- id: ${fact.id}`,
    `  theme: ${fact.theme}`,
    `  nature: ${fact.nature}`,
    `  statement: ${truncate(fact.statement, 260)}`,
    `  priorityScore: ${fact.priorityScore ?? 0}`,
    `  confidenceScore: ${fact.confidenceScore ?? 0}`,
    `  tags: ${(fact.tags ?? []).join(", ") || "aucun"}`,
    `  evidenceCount: ${(fact.sources ?? []).length}`,
  ].join("\n");
}

function serializeSignal(signal: DiagnosticSignal): string {
  return [
    `- id: ${signal.id}`,
    `  theme: ${signal.theme}`,
    `  signalKind: ${signal.signalKind}`,
    `  constat: ${truncate(signal.constat, 220)}`,
    `  managerialRisk: ${truncate(signal.managerialRisk, 220)}`,
    `  probableConsequence: ${truncate(signal.probableConsequence, 220)}`,
    `  criticalityScore: ${signal.criticalityScore}`,
    `  confidenceScore: ${signal.confidenceScore}`,
  ].join("\n");
}

function serializeBaseline(baseline: DimensionAnalysisSnapshot): string {
  const swot = baseline.swot ?? emptySwotSnapshot();

  return JSON.stringify(
    {
      summary: baseline.summary ?? "",
      keyFindings: baseline.keyFindings ?? [],
      rootCauseHypotheses: safeArray(baseline.rootCauseHypotheses).map((item) => ({
        label: item.label,
        rationale: item.rationale,
        confidenceScore: item.confidenceScore,
      })),
      swot: {
        strengths: safeArray(swot.strengths).map((item) => ({
          label: item.label,
          rationale: item.rationale,
        })),
        weaknesses: safeArray(swot.weaknesses).map((item) => ({
          label: item.label,
          rationale: item.rationale,
        })),
        opportunities: safeArray(swot.opportunities).map((item) => ({
          label: item.label,
          rationale: item.rationale,
        })),
        threats: safeArray(swot.threats).map((item) => ({
          label: item.label,
          rationale: item.rationale,
        })),
      },
      objectiveSeeds: safeArray(baseline.objectiveSeeds).map((item) => ({
        label: item.label,
        indicator: item.indicator,
        rationale: item.rationale,
        suggestedDueDate: item.suggestedDueDate,
        potentialGain: item.potentialGain,
        quickWin: item.quickWin,
      })),
      nonPilotedAreas: baseline.nonPilotedAreas ?? [],
    },
    null,
    2
  );
}

function buildPrompt(params: LlmRefinementInput): string {
  const factMaterial =
    params.facts.length > 0
      ? params.facts.slice(0, 10).map(serializeFact).join("\n\n")
      : "Aucun fait consolidé.";

  const signalMaterial =
    params.signals.length > 0
      ? params.signals.slice(0, 10).map(serializeSignal).join("\n\n")
      : "Aucun signal.";

  const trameExcerpt = truncate(params.trameText ?? "", 5000);

  return [
    "Tu es un consultant senior en diagnostic dirigeant de PME.",
    "Tu reçois une consolidation DETERMINISTE déjà calculée.",
    "Ta mission n'est PAS de créer de nouveaux faits, mais d'améliorer la formulation métier.",
    "",
    "Règles impératives :",
    "- ne jamais inventer de fait absent du matériau",
    "- ne pas ajouter de nouveau thème",
    "- conserver le sens des éléments existants",
    "- reformuler de manière plus crédible, plus métier, moins mécanique",
    "- rester prudent",
    "- si un élément est faible ou insuffisamment étayé, le conserver avec prudence plutôt que l'amplifier",
    "- répondre STRICTEMENT en JSON",
    "",
    "Le JSON attendu est :",
    "{",
    '  "summary": "string",',
    '  "keyFindings": ["string", "string", "string"],',
    '  "rootCauseHypotheses": [{"label":"string","rationale":"string","confidenceScore":70}],',
    '  "swot": {',
    '    "strengths": [{"label":"string","rationale":"string"}],',
    '    "weaknesses": [{"label":"string","rationale":"string"}],',
    '    "opportunities": [{"label":"string","rationale":"string"}],',
    '    "threats": [{"label":"string","rationale":"string"}]',
    "  },",
    '  "objectiveSeeds": [{"label":"string","indicator":"string","rationale":"string","suggestedDueDate":"string","potentialGain":"string","quickWin":"string"}],',
    '  "nonPilotedAreas": [{"constat":"string","risqueManagerial":"string","consequence":"string"}]',
    "}",
    "",
    `DIMENSION : ${params.dimensionId} — ${dimensionTitle(params.dimensionId)}`,
    "",
    "BASELINE DETERMINISTE :",
    serializeBaseline(params.baseline),
    "",
    "FACTS PRIORITAIRES :",
    factMaterial,
    "",
    "SIGNALS PRIORITAIRES :",
    signalMaterial,
    "",
    "EXTRAIT DE TRAME :",
    trameExcerpt || "Aucun extrait disponible.",
  ].join("\n");
}

function mergeKeyFindings(
  baseline: string[] | undefined,
  refined: string[] | undefined
): [string, string, string] {
  const fallbackBaseline = safeArray(baseline);
  const next = safeArray(refined)
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .slice(0, 3);

  while (next.length < 3) {
    next.push(
      fallbackBaseline[next.length] ??
        fallbackBaseline[0] ??
        "Point de consolidation à préciser."
    );
  }

  return [
    next[0] ?? "Point de consolidation à préciser.",
    next[1] ?? fallbackBaseline[1] ?? fallbackBaseline[0] ?? "Point de consolidation à préciser.",
    next[2] ?? fallbackBaseline[2] ?? fallbackBaseline[0] ?? "Point de consolidation à préciser.",
  ];
}

function mergeRootCauseHypotheses(
  baseline: RootCauseHypothesis[] | undefined,
  refined: ParsedRootCauseHypothesis[] | undefined
): RootCauseHypothesis[] {
  const base = safeArray(baseline);
  const parsed = safeArray(refined);

  if (base.length === 0) {
    return [];
  }

  return base.map((item, index) => {
    const patch = parsed[index];
    if (!patch) return item;

    const label = normalizeText(patch.label);
    const rationale = normalizeText(patch.rationale);
    const confidenceScore = clampInt(
      patch.confidenceScore,
      40,
      95,
      item.confidenceScore ?? 60
    );

    return {
      ...item,
      label: label || item.label,
      rationale: rationale || item.rationale,
      confidenceScore,
      confidence: confidenceScore / 100,
    };
  });
}

function mergeSwotList(
  baseline: SwotItem[] | undefined,
  refined: ParsedSwotItem[] | undefined
): SwotItem[] {
  const base = safeArray(baseline);
  const parsed = safeArray(refined);

  return base.map((item, index) => {
    const patch = parsed[index];
    if (!patch) return item;

    const label = normalizeText(patch.label);
    const rationale = normalizeText(patch.rationale);

    return {
      ...item,
      label: label || item.label,
      rationale: rationale || item.rationale,
    };
  });
}

function mergeSwot(
  baseline: SwotSnapshot | undefined,
  refined: ParsedRefinementPayload["swot"]
): SwotSnapshot {
  const safeBaseline = baseline ?? emptySwotSnapshot();

  return {
    strengths: mergeSwotList(safeBaseline.strengths, refined?.strengths),
    weaknesses: mergeSwotList(safeBaseline.weaknesses, refined?.weaknesses),
    opportunities: mergeSwotList(safeBaseline.opportunities, refined?.opportunities),
    threats: mergeSwotList(safeBaseline.threats, refined?.threats),
  };
}

function mergeObjectiveSeeds(
  baseline: ObjectiveSeed[] | undefined,
  refined: ParsedObjectiveSeed[] | undefined
): ObjectiveSeed[] {
  const base = safeArray(baseline);
  const parsed = safeArray(refined);

  return base.map((item, index) => {
    const patch = parsed[index];
    if (!patch) return item;

    const label = normalizeText(patch.label);
    const indicator = normalizeText(patch.indicator);
    const rationale = normalizeText(patch.rationale);
    const suggestedDueDate = normalizeText(patch.suggestedDueDate);
    const potentialGain = normalizeText(patch.potentialGain);
    const quickWin = normalizeText(patch.quickWin);

    return {
      ...item,
      label: label || item.label,
      indicator: indicator || item.indicator,
      rationale: rationale || item.rationale,
      suggestedDueDate: suggestedDueDate || item.suggestedDueDate,
      potentialGain: potentialGain || item.potentialGain,
      quickWin: quickWin || item.quickWin,
    };
  });
}

function mergeNonPilotedAreas(
  baseline: ZoneNonPilotee[] | undefined,
  refined: ParsedZone[] | undefined
): ZoneNonPilotee[] {
  const base = safeArray(baseline);
  const parsed = safeArray(refined);

  return base.map((item, index) => {
    const patch = parsed[index];
    if (!patch) return item;

    const constat = normalizeText(patch.constat);
    const risqueManagerial = normalizeText(patch.risqueManagerial);
    const consequence = normalizeText(patch.consequence);

    return {
      constat: constat || item.constat,
      risqueManagerial: risqueManagerial || item.risqueManagerial,
      consequence: consequence || item.consequence,
    };
  });
}

function mergeRefinedAnalysis(
  baseline: DimensionAnalysisSnapshot,
  refined: ParsedRefinementPayload
): DimensionAnalysisSnapshot {
  const summary = normalizeText(refined.summary);

  return {
    ...baseline,
    summary: summary || baseline.summary,
    keyFindings: mergeKeyFindings(baseline.keyFindings, refined.keyFindings),
    rootCauseHypotheses: mergeRootCauseHypotheses(
      baseline.rootCauseHypotheses,
      refined.rootCauseHypotheses
    ),
    swot: mergeSwot(baseline.swot, refined.swot),
    objectiveSeeds: mergeObjectiveSeeds(baseline.objectiveSeeds, refined.objectiveSeeds),
    nonPilotedAreas: mergeNonPilotedAreas(
      baseline.nonPilotedAreas,
      refined.nonPilotedAreas
    ),
  };
}

export function llmDimensionConsolidationEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function refineDimensionConsolidationWithLlm(
  params: LlmRefinementInput
): Promise<DimensionAnalysisSnapshot> {
  const client = getClient();

  if (!client) {
    return params.baseline;
  }

  if ((params.baseline.facts ?? []).length === 0) {
    return params.baseline;
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
            "Tu affines une consolidation de diagnostic dirigeant. Tu n'inventes aucun fait. Tu réponds strictement en JSON.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const parsed = tryParseJson(raw);

    if (!parsed) {
      return params.baseline;
    }

    return compactJson(mergeRefinedAnalysis(params.baseline, parsed));
  } catch {
    return params.baseline;
  }
}