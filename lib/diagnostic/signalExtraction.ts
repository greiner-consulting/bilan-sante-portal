import OpenAI from "openai";
import { DIAGNOSTIC_DIMENSIONS } from "@/lib/bilan-sante/protocol";
import type {
  BaseTrameSnapshot,
  TrameSection,
} from "@/lib/bilan-sante/session-model";

export type LlmExtractedSignalFact = {
  sectionId?: string | null;
  dimensionId: number;
  theme: string;
  constat: string;
  evidenceQuote: string;
  managerialRisk: string;
  probableConsequence: string;
  entryAngle: string;
  criticalityScore: number;
  confidenceScore: number;
};

type LlmResponse = {
  facts?: unknown[];
};

let cachedClient: OpenAI | null | undefined;

function getOpenAiClient(): OpenAI | null {
  if (cachedClient !== undefined) {
    return cachedClient;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    cachedClient = null;
    return cachedClient;
  }

  cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}

function normalizeWhitespace(value: string): string {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isLikelyNoiseLine(line: string): boolean {
  const text = normalizeWhitespace(line);
  if (!text) return true;

  const digits = (text.match(/\d/g) ?? []).length;
  const letters = (text.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;
  const currency = (text.match(/[€$£%]/g) ?? []).length;

  if (letters === 0 && digits >= 5) return true;

  if (
    digits >= 8 &&
    letters <= 8 &&
    /^(?:[\d\s.,;:/()%€-]+)$/.test(text)
  ) {
    return true;
  }

  if (
    digits > letters * 1.4 &&
    currency === 0 &&
    !/\b(ca|marge|cash|charge|effectif|chef|projet|client|prix|devis|chiffrage|planning|achat)\b/i.test(
      text
    )
  ) {
    return true;
  }

  return false;
}

function cleanSectionContent(section: TrameSection): string {
  const rawLines = normalizeWhitespace(section.content)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const cleanedLines = rawLines.filter((line) => !isLikelyNoiseLine(line));

  const candidate = cleanedLines.join("\n").trim();
  if (candidate.length >= 60) {
    return candidate;
  }

  return normalizeWhitespace(section.content);
}

function prepareSections(snapshot: BaseTrameSnapshot): Array<{
  id: string;
  heading: string;
  content: string;
}> {
  return snapshot.sections
    .map((section) => {
      const content = cleanSectionContent(section);

      return {
        id: section.id,
        heading: normalizeWhitespace(section.heading),
        content: content.slice(0, 1400),
      };
    })
    .filter((section) => section.content.length >= 50)
    .slice(0, 18);
}

function buildSystemPrompt(): string {
  return `
Tu es un consultant senior spécialisé dans le diagnostic de PME/ETI.

Ta tâche :
extraire des faits managériaux réellement exploitables à partir d'une trame dirigeant.

Règles absolues :
- Tu ne recopies jamais mécaniquement des suites de chiffres incompréhensibles.
- Tu ignores les artefacts OCR, tableaux mal extraits, fragments numériques sans sens métier.
- Tu n'inventes aucun fait absent.
- Tu ne produis ni recommandations ni plan d'actions.
- Tu produis uniquement des faits utiles au diagnostic.
- Chaque fait doit être rattaché à UNE dimension principale.
- Le champ "theme" doit être choisi STRICTEMENT parmi les thèmes autorisés de la dimension retenue.
- Le champ "evidenceQuote" doit être court, compréhensible, et issu de la trame.
- Le champ "constat" doit être rédigé comme un constat consultant, sobre et métier.
- Le champ "managerialRisk" doit exprimer le risque de pilotage.
- Le champ "probableConsequence" doit exprimer la conséquence probable.
- entryAngle doit être choisi parmi :
  mechanism, formalization, causality, arbitration, dependency, economics, execution, market, pricing, people
- criticalityScore et confidenceScore sont des entiers entre 0 et 100.
- Ne retourne que du JSON strict.

Format de sortie obligatoire :
{
  "facts": [
    {
      "sectionId": "string ou null",
      "dimensionId": 1,
      "theme": "string",
      "constat": "string",
      "evidenceQuote": "string",
      "managerialRisk": "string",
      "probableConsequence": "string",
      "entryAngle": "string",
      "criticalityScore": 80,
      "confidenceScore": 85
    }
  ]
}
`.trim();
}

function buildUserPayload(snapshot: BaseTrameSnapshot) {
  const sections = prepareSections(snapshot);

  return {
    dimensions: DIAGNOSTIC_DIMENSIONS.map((dimension) => ({
      id: dimension.id,
      title: dimension.title,
      themes: dimension.requiredThemes,
    })),
    instructions: {
      language: "fr",
      ignoreNumericNoise: true,
      maxFacts: 20,
      objective: "extraire des faits managériaux pour le diagnostic 4D",
    },
    sections,
    qualityFlags: snapshot.qualityFlags.map((flag) => ({
      severity: flag.severity,
      message: flag.message,
    })),
    missingFields: snapshot.missingFields.map((field) => ({
      label: field.label,
      dimensionId: field.dimensionId ?? null,
      sourceText: field.sourceText,
    })),
  };
}

function asString(value: unknown): string {
  return String(value ?? "").trim();
}

function asNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeFact(raw: unknown): LlmExtractedSignalFact | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const fact = raw as Record<string, unknown>;

  const dimensionId = Number(fact.dimensionId);
  if (![1, 2, 3, 4].includes(dimensionId)) {
    return null;
  }

  const theme = asString(fact.theme);
  const constat = asString(fact.constat);
  const evidenceQuote = asString(fact.evidenceQuote);

  if (theme.length < 3 || constat.length < 20 || evidenceQuote.length < 10) {
    return null;
  }

  return {
    sectionId: asString(fact.sectionId) || null,
    dimensionId,
    theme,
    constat,
    evidenceQuote,
    managerialRisk: asString(fact.managerialRisk),
    probableConsequence: asString(fact.probableConsequence),
    entryAngle: asString(fact.entryAngle),
    criticalityScore: asNumber(fact.criticalityScore, 75),
    confidenceScore: asNumber(fact.confidenceScore, 75),
  };
}

export async function extractSignalFactsFromSnapshot(
  snapshot: BaseTrameSnapshot
): Promise<LlmExtractedSignalFact[]> {
  const client = getOpenAiClient();
  if (!client) return [];

  const preparedSections = prepareSections(snapshot);
  if (preparedSections.length === 0) return [];

  const model =
    process.env.OPENAI_MODEL_SIGNAL_EXTRACTION ||
    process.env.OPENAI_MODEL_CHAT ||
    "gpt-4o-mini";

  try {
    const response = await client.chat.completions.create({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(),
        },
        {
          role: "user",
          content: JSON.stringify(buildUserPayload(snapshot)),
        },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as LlmResponse;

    const facts = Array.isArray(parsed.facts) ? parsed.facts : [];

    return facts
      .map(normalizeFact)
      .filter(Boolean) as LlmExtractedSignalFact[];
  } catch {
    return [];
  }
}