import OpenAI from "openai";
import type {
  DiagnosticSignal,
  EntryAngle,
  FrozenDimensionDiagnosis,
  MemoryInsight,
  ZoneNonPilotee,
} from "@/lib/bilan-sante/session-model";
import type { DimensionId, IterationNumber } from "@/lib/bilan-sante/protocol";

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  if (!cachedClient) {
    cachedClient = new OpenAI({ apiKey });
  }

  return cachedClient;
}

function modelName(): string {
  return process.env.OPENAI_MODEL_CHAT || "gpt-4o-mini";
}

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function truncate(value: unknown, max = 220): string {
  const text = normalizeText(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

function jsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function llmDiagnosticWriterEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

function iterationObjective(iteration: IterationNumber): string {
  switch (iteration) {
    case 1:
      return "cadrage et compréhension initiale du fonctionnement réel";
    case 2:
      return "approfondissement des causes, arbitrages, dépendances et mécanismes";
    case 3:
      return "consolidation, signaux de pilotage, zones non pilotées et risques explicites";
    default:
      return "questionnement qualitatif";
  }
}

function buildQuestionFallback(params: {
  iteration: IterationNumber;
  theme: string;
  constat: string;
  managerialRisk: string;
  entryAngle: EntryAngle;
  trameEvidence?: string;
  facts?: string[];
  isAbsence?: boolean;
}): string {
  const theme = normalizeText(params.theme);
  const evidence = truncate(params.trameEvidence, 180);
  const fact = truncate(params.facts?.[0], 160);

  if (params.iteration === 1) {
    if (params.isAbsence) {
      return `Sur le thème "${theme}", le sujet n’apparaît pas clairement structuré dans la trame. Comment ce sujet se traite-t-il aujourd’hui en pratique : qui intervient, comment la décision se prend-elle, et où voyez-vous les principaux points de fragilité ?${fact ? ` Vous avez déjà évoqué : "${fact}".` : ""}`;
    }

    return `Sur le thème "${theme}", la trame fait ressortir : "${evidence || truncate(params.constat, 160)}". Décrivez-moi le fonctionnement réel aujourd’hui : quelles étapes, quels acteurs, quelles décisions concrètes et quelles limites observez-vous ?${fact ? ` Vous avez déjà évoqué : "${fact}".` : ""}`;
  }

  if (params.iteration === 2) {
    return `Si l’on creuse le thème "${theme}", qu’est-ce qui explique réellement la situation actuelle : compétences, organisation, arbitrages, dépendances ou choix managériaux ? Donnez-moi le mécanisme concret qui produit cette situation.${fact ? ` Point déjà mentionné : "${fact}".` : ""}`;
  }

  return `Sur le thème "${theme}", quel point reste aujourd’hui le moins sécurisé ou le moins piloté, et quel risque concret cela crée-t-il pour l’entreprise ? Si vous deviez rendre ce point pilotable, qu’est-ce qu’il faudrait objectiver ou formaliser en priorité ?${fact ? ` Appui déjà cité : "${fact}".` : ""}`;
}

export async function composeQuestionWithLlm(params: {
  dimensionId: DimensionId;
  dimensionTitle: string;
  iteration: IterationNumber;
  theme: string;
  constat: string;
  managerialRisk: string;
  entryAngle: EntryAngle;
  trameEvidence?: string;
  extractedFacts?: string[];
  coveredAngles?: EntryAngle[];
  rejectedAngles?: EntryAngle[];
  isAbsence?: boolean;
}): Promise<string> {
  const fallback = buildQuestionFallback({
    iteration: params.iteration,
    theme: params.theme,
    constat: params.constat,
    managerialRisk: params.managerialRisk,
    entryAngle: params.entryAngle,
    trameEvidence: params.trameEvidence,
    facts: params.extractedFacts,
    isAbsence: params.isAbsence,
  });

  const client = getClient();
  if (!client) return fallback;

  const prompt = [
    "Tu es un consultant senior en diagnostic dirigeant.",
    "Rédige UNE seule question, en français professionnel naturel.",
    "Le but n'est pas de remplir un quota, mais d'obtenir une matière managériale utile.",
    "Tu as de la liberté de formulation, mais tu dois respecter les contraintes suivantes :",
    "- rester strictement sur le thème fourni",
    "- partir du constat et du risque managérial fournis",
    "- poser une question ouverte, concrète, qualitative",
    "- éviter tout libellé générique réutilisable tel quel sur n'importe quel thème",
    "- éviter les demandes artificielles de chiffres",
    "- faire apparaître les arbitrages, mécanismes, dépendances ou zones non pilotées quand c'est utile",
    "- pour l'itération 3, ne pas recycler mécaniquement la formule 'insuffisamment clarifié, formalisé ou sécurisé' ; varier l'angle selon le thème réel",
    "- répondre uniquement avec le texte de la question, sans liste ni préambule",
    "",
    `Dimension : ${params.dimensionId} — ${params.dimensionTitle}`,
    `Itération : ${params.iteration}/3 (${iterationObjective(params.iteration)})`,
    `Thème : ${normalizeText(params.theme)}`,
    `Constat : ${normalizeText(params.constat)}`,
    `Risque managérial : ${normalizeText(params.managerialRisk)}`,
    `Angle suggéré : ${params.entryAngle}`,
    `Signal d'absence : ${params.isAbsence ? "oui" : "non"}`,
    `Évidence trame : ${truncate(params.trameEvidence, 320) || "aucune citation utile"}`,
    `Faits déjà acquis : ${(params.extractedFacts ?? []).map((item) => truncate(item, 160)).join(" | ") || "aucun"}`,
    `Angles déjà couverts : ${(params.coveredAngles ?? []).join(", ") || "aucun"}`,
    `Angles à éviter : ${(params.rejectedAngles ?? []).join(", ") || "aucun"}`,
  ].join("\n");

  try {
    const response = await client.chat.completions.create({
      model: modelName(),
      temperature: 0.6,
      messages: [
        {
          role: "system",
          content:
            "Tu rédiges des questions de diagnostic dirigeant. Tu ne réponds qu'avec une seule question en français.",
        },
        { role: "user", content: prompt },
      ],
    });

    const text = normalizeText(response.choices[0]?.message?.content);
    if (!text) return fallback;
    return text;
  } catch {
    return fallback;
  }
}

type FrozenLlmShape = {
  consolidatedFindings?: string[];
  dominantRootCause?: string;
  unmanagedZones?: Array<{
    constat?: string;
    risqueManagerial?: string;
    consequence?: string;
  }>;
};

function sanitizeZones(raw: unknown): ZoneNonPilotee[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => {
      const row = (item ?? {}) as Record<string, unknown>;
      return {
        constat: truncate(row.constat, 220),
        risqueManagerial: truncate(row.risqueManagerial, 220),
        consequence: truncate(row.consequence, 220),
      };
    })
    .filter(
      (item) =>
        normalizeText(item.constat) &&
        normalizeText(item.risqueManagerial) &&
        normalizeText(item.consequence)
    )
    .slice(0, 4);
}

export async function buildFrozenDimensionNarrativeWithLlm(params: {
  dimensionId: DimensionId;
  dimensionTitle: string;
  signals: DiagnosticSignal[];
  memory: MemoryInsight[];
  fallback: Pick<
    FrozenDimensionDiagnosis,
    "consolidatedFindings" | "dominantRootCause" | "unmanagedZones"
  >;
}): Promise<Pick<FrozenDimensionDiagnosis, "consolidatedFindings" | "dominantRootCause" | "unmanagedZones">> {
  const client = getClient();
  if (!client) return params.fallback;

  const signalPayload = params.signals.slice(0, 10).map((signal) => ({
    theme: signal.theme,
    kind: signal.signalKind,
    constat: truncate(signal.constat, 200),
    risk: truncate(signal.managerialRisk, 200),
    consequence: truncate(signal.probableConsequence, 200),
    entryAngle: signal.entryAngle,
    excerpt: truncate(signal.sourceExcerpt, 180),
  }));

  const memoryPayload = params.memory.slice(-12).map((item) => ({
    theme: item.theme,
    summary: truncate(item.summary, 180),
    facts: (item.extractedFacts ?? []).slice(0, 2).map((x) => truncate(x, 120)),
    causes: item.detectedRootCauses ?? [],
  }));

  const prompt = [
    "Tu consolides une dimension de diagnostic dirigeant.",
    "Tu dois produire un JSON strict avec :",
    '- consolidatedFindings: tableau de 3 constats consolidés, chacun spécifique, non générique, orienté management',
    '- dominantRootCause: une seule cause racine dominante, formulée clairement',
    '- unmanagedZones: 2 à 4 zones non pilotées avec constat / risqueManagerial / consequence',
    "Contraintes :",
    "- ne rien inventer hors matière fournie",
    "- fusionner les signaux convergents au lieu de les juxtaposer",
    "- garder un niveau dirigeant, pas analytique faible",
    "- éviter les phrases génériques réutilisables",
    "- répondre en JSON strict uniquement",
    `Dimension : ${params.dimensionId} — ${params.dimensionTitle}`,
    `Signaux : ${JSON.stringify(signalPayload)}`,
    `Matière dirigeant : ${JSON.stringify(memoryPayload)}`,
  ].join("\n");

  try {
    const response = await client.chat.completions.create({
      model: modelName(),
      temperature: 0.5,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Tu consolides un diagnostic de dimension. Réponds uniquement en JSON valide.",
        },
        { role: "user", content: prompt },
      ],
    });

    const raw = normalizeText(response.choices[0]?.message?.content);
    const parsed = jsonParse<FrozenLlmShape>(raw);
    if (!parsed) return params.fallback;

    const findings = Array.isArray(parsed.consolidatedFindings)
      ? parsed.consolidatedFindings
          .map((item) => truncate(item, 240))
          .filter(Boolean)
          .slice(0, 3)
      : [];

    const dominantRootCause = truncate(parsed.dominantRootCause, 260);
    const unmanagedZones = sanitizeZones(parsed.unmanagedZones);

    if (findings.length < 3 || !dominantRootCause || unmanagedZones.length === 0) {
      return params.fallback;
    }

    return {
      consolidatedFindings: [findings[0], findings[1], findings[2]],
      dominantRootCause,
      unmanagedZones,
    };
  } catch {
    return params.fallback;
  }
}
