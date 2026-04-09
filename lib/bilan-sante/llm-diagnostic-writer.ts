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

function uniqueStrings(values: Array<string | null | undefined>, max?: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const text = normalizeText(value);
    if (!text) continue;
    const key = text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (max != null && out.length >= max) break;
  }

  return out;
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

function anglePrompt(angle: EntryAngle): string {
  switch (angle) {
    case "causality":
      return "fais apparaître la cause racine, le mécanisme déclencheur ou le vrai facteur explicatif";
    case "arbitration":
      return "fais apparaître la chaîne d'arbitrage, de décision ou de validation";
    case "economics":
      return "fais apparaître le lien avec marge, coût réel, cash, rentabilité ou sélectivité";
    case "formalization":
      return "fais apparaître ce qui n'est pas cadré, ritualisé, objectivé ou formalisé";
    case "dependency":
      return "fais apparaître la dépendance à une personne, un passage obligé, une ressource rare ou un relais fragile";
    case "mechanism":
    default:
      return "fais apparaître le fonctionnement réel, l'enchaînement concret et le point de rupture";
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
  const constat = normalizeText(params.constat);
  const lowerConstat = constat
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const growthLike =
    lowerConstat.includes("croissance") ||
    lowerConstat.includes("si la croissance arrive") ||
    lowerConstat.includes("besoin de recruter") ||
    lowerConstat.includes("montee en charge") ||
    lowerConstat.includes("montée en charge");

  if (params.iteration === 1) {
    if (growthLike && theme === "qualité et adéquation des équipes") {
      return "Si l’activité accélère, qu’est-ce qui risque de bloquer d’abord dans votre capacité à suivre ?";
    }

    if (params.isAbsence) {
      switch (params.entryAngle) {
        case "dependency":
          return `Sur "${theme}", de qui ou de quoi dépendez-vous le plus aujourd’hui ?`;
        case "arbitration":
          return `Sur "${theme}", qui tranche réellement quand il faut décider ?`;
        case "economics":
          return `Sur "${theme}", quel impact concret voyez-vous aujourd’hui sur le coût, la marge ou le cash ?`;
        case "formalization":
          return `Sur "${theme}", qu’est-ce qui n’est pas assez cadré aujourd’hui ?`;
        default:
          return `Sur "${theme}", comment cela se passe-t-il concrètement aujourd’hui ?`;
      }
    }

    switch (params.entryAngle) {
      case "dependency":
        return `Sur "${theme}", de qui ou de quoi dépendez-vous le plus aujourd’hui ?`;
      case "arbitration":
        return `Sur "${theme}", qui tranche réellement quand il faut décider ?`;
      case "economics":
        return `Sur "${theme}", quel impact concret cela a-t-il aujourd’hui sur le coût, la marge ou le cash ?`;
      case "formalization":
        return `Sur "${theme}", qu’est-ce qui n’est pas assez cadré aujourd’hui ?`;
      default:
        return `Sur "${theme}", comment cela se passe-t-il concrètement aujourd’hui ?`;
    }
  }

  if (params.iteration === 2) {
    if (growthLike && theme === "qualité et adéquation des équipes") {
      return "Si la charge augmente vite, où serait selon vous le premier manque : recrutement, intégration, encadrement ou profils terrain ?";
    }

    switch (params.entryAngle) {
      case "causality":
        return `Sur "${theme}", qu’est-ce qui explique surtout la situation actuelle ?`;
      case "arbitration":
        return `Sur "${theme}", où la décision se bloque-t-elle aujourd’hui ?`;
      case "dependency":
        return `Sur "${theme}", quelle dépendance pèse le plus aujourd’hui ?`;
      case "economics":
        return `Sur "${theme}", où se voit aujourd’hui l’impact économique réel ?`;
      case "formalization":
        return `Sur "${theme}", qu’est-ce qui manque surtout pour piloter correctement le sujet ?`;
      default:
        return `Sur "${theme}", qu’est-ce qui explique surtout la situation actuelle ?`;
    }
  }

  if (growthLike && theme === "qualité et adéquation des équipes") {
    return "En cas de croissance rapide, quel est le point que vous maîtrisez le moins aujourd’hui ?";
  }

  switch (params.entryAngle) {
    case "arbitration":
      return `Sur "${theme}", quel arbitrage reste aujourd’hui le moins clair ?`;
    case "dependency":
      return `Sur "${theme}", quelle dépendance reste aujourd’hui la plus risquée ?`;
    case "economics":
      return `Sur "${theme}", quel point est aujourd’hui le moins piloté sur le plan économique ?`;
    case "formalization":
      return `Sur "${theme}", quel point reste aujourd’hui le moins cadré ?`;
    case "causality":
      return `Sur "${theme}", quelle cause racine domine encore aujourd’hui ?`;
    default:
      return `Sur "${theme}", quel est aujourd’hui le point le moins maîtrisé ?`;
  }
}

function normalizeQuestionOutput(value: unknown, fallback: string): string {
  const text = normalizeText(value);
  if (!text) return fallback;
  if (/[?؟]$/.test(text)) return text;
  return `${text}?`;
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
    "Tu es un consultant senior en diagnostic dirigeant de PME.",
    "Tu dois rédiger UNE seule question, en français naturel, concret, direct.",
    "",
    "But : faire parler le dirigeant sur le point précis à éclairer, sans reformuler un cours de management.",
    "",
    "Contraintes impératives :",
    "- une seule question",
    "- une phrase courte",
    "- une seule idée directrice",
    "- rester strictement aligné sur le constat fourni",
    "- si le constat décrit une tension future, une montée en charge, un besoin de recrutement ou un risque de rupture, la question doit viser ce point de bascule",
    "- ne pas réécrire le constat dans la question",
    "- ne pas réécrire le risque dans la question",
    "- ne pas utiliser de préambule théorique",
    "- bannir les formulations du type : 'dans un contexte où', 'afin de', 'en tenant compte de', 'comment anticipez-vous efficacement'",
    "- bannir les questions génériques qui pourraient s’appliquer à n’importe quel thème",
    "- privilégier des formulations comme :",
    '  * "Aujourd’hui, comment ... ?" ',
    '  * "Si cela arrive, qu’est-ce qui bloque d’abord ?" ',
    '  * "Qui tranche réellement ?" ',
    '  * "Quel est aujourd’hui le point le moins maîtrisé ?" ',
    "",
    "Règle essentielle :",
    "- si le constat dit qu’une situation est correcte aujourd’hui mais fragile demain, la question doit porter sur la fragilité future, pas sur le fonctionnement général actuel",
    "",
    "Réponds uniquement avec le texte final de la question.",
    "",
    `Dimension : ${params.dimensionId} — ${params.dimensionTitle}`,
    `Itération : ${params.iteration}/3 (${iterationObjective(params.iteration)})`,
    `Thème : ${normalizeText(params.theme)}`,
    `Constat : ${normalizeText(params.constat)}`,
    `Risque managérial : ${normalizeText(params.managerialRisk)}`,
    `Angle suggéré : ${params.entryAngle}`,
    `Indication angle : ${anglePrompt(params.entryAngle)}.`,
    `Signal d'absence : ${params.isAbsence ? "oui" : "non"}`,
    `Évidence trame : ${truncate(params.trameEvidence, 360) || "aucune citation utile"}`,
    `Faits déjà acquis : ${uniqueStrings((params.extractedFacts ?? []).map((item) => truncate(item, 170)), 4).join(" | ") || "aucun"}`,
    `Angles déjà couverts : ${uniqueStrings(params.coveredAngles ?? []).join(", ") || "aucun"}`,
    `Angles à éviter : ${uniqueStrings(params.rejectedAngles ?? []).join(", ") || "aucun"}`,
  ].join("\n");

  try {
    const response = await client.chat.completions.create({
      model: modelName(),
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Tu rédiges des questions de diagnostic dirigeant. Une seule question. Français naturel, concret, direct. Aucun commentaire.",
        },
        { role: "user", content: prompt },
      ],
    });

    return normalizeQuestionOutput(response.choices[0]?.message?.content, fallback);
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

  const signalPayload = params.signals.slice(0, 12).map((signal) => ({
    theme: signal.theme,
    kind: signal.signalKind,
    constat: truncate(signal.constat, 200),
    risk: truncate(signal.managerialRisk, 200),
    consequence: truncate(signal.probableConsequence, 200),
    entryAngle: signal.entryAngle,
    excerpt: truncate(signal.sourceExcerpt, 180),
  }));

  const memoryPayload = params.memory.slice(-14).map((item) => ({
    theme: item.theme,
    summary: truncate(item.summary, 180),
    facts: uniqueStrings((item.extractedFacts ?? []).map((x) => truncate(x, 120)), 3),
    causes: item.detectedRootCauses ?? [],
  }));

  const prompt = [
    "Tu consolides une dimension de diagnostic dirigeant.",
    "Tu dois produire un JSON strict avec :",
    '- consolidatedFindings: tableau de 3 constats consolidés, chacun spécifique, fusionné, non générique, orienté management et pilotage',
    '- dominantRootCause: une seule cause racine dominante, formulée clairement',
    '- unmanagedZones: 2 à 4 zones non pilotées avec constat / risqueManagerial / consequence',
    "Contraintes :",
    "- ne rien inventer hors matière fournie",
    "- fusionner les signaux convergents au lieu de les juxtaposer",
    "- faire ressortir en priorité la zone non pilotée dominante dans le premier unmanagedZone",
    "- chaque constat consolidé doit aider un dirigeant à arbitrer, pas simplement redire un symptôme",
    "- privilégier les formulations qui éclairent les arbitrages, dépendances, défauts de pilotage ou zones hors contrôle",
    "- éviter les phrases génériques réutilisables",
    "- ne pas appeler 'force' un élément qui est en réalité une vulnérabilité",
    "- répondre en JSON strict uniquement",
    `Dimension : ${params.dimensionId} — ${params.dimensionTitle}`,
    `Signaux : ${JSON.stringify(signalPayload)}`,
    `Matière dirigeant : ${JSON.stringify(memoryPayload)}`,
  ].join("\n");

  try {
    const response = await client.chat.completions.create({
      model: modelName(),
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Tu consolides un diagnostic de dimension. Réponds uniquement en JSON valide, dense et spécifique.",
        },
        { role: "user", content: prompt },
      ],
    });

    const raw = normalizeText(response.choices[0]?.message?.content);
    const parsed = jsonParse<FrozenLlmShape>(raw);
    if (!parsed) return params.fallback;

    const findings = Array.isArray(parsed.consolidatedFindings)
      ? uniqueStrings(
          parsed.consolidatedFindings.map((item) => truncate(item, 240)),
          3
        )
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