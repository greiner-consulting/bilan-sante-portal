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
  const constat = truncate(params.constat, 170);
  const risk = truncate(params.managerialRisk, 170);
  const evidence = truncate(params.trameEvidence, 170);
  const fact = truncate(params.facts?.[0], 150);
  const anchor = fact ? ` Vous avez déjà mentionné par exemple : "${fact}".` : "";

  if (params.iteration === 1) {
    if (params.isAbsence) {
      switch (params.entryAngle) {
        case "dependency":
          return `Sur le thème "${theme}", la trame ne permet pas de voir clairement où se situe la dépendance opérationnelle. Aujourd'hui, sur qui ou sur quoi ce sujet repose-t-il réellement, à quel moment cela bloque-t-il, et quel risque concret cela crée-t-il ?${anchor}`;
        case "arbitration":
          return `Sur le thème "${theme}", la trame ne montre pas clairement qui arbitre et comment la décision se prend. Concrètement, qui décide aujourd'hui, où la validation se fait-elle, et où voyez-vous les principaux frottements ?${anchor}`;
        case "economics":
          return `Sur le thème "${theme}", la trame n'éclaire pas clairement l'impact économique du sujet. Comment ce point se traduit-il aujourd'hui sur la marge, le coût réel, le cash ou la rentabilité, et comment le voyez-vous dans les faits ?${anchor}`;
        case "formalization":
          return `Sur le thème "${theme}", la trame laisse penser que le sujet n'est pas objectivé de façon suffisamment lisible. Comment ce sujet est-il piloté aujourd'hui, avec quels rôles, quels rituels ou quelles règles, et où se situe la vraie fragilité ?${anchor}`;
        default:
          return `Sur le thème "${theme}", la trame ne permet pas de comprendre clairement le fonctionnement réel. Comment ce sujet se traite-t-il aujourd'hui en pratique, avec quels acteurs, quelles étapes et quel point de fragilité principal ?${anchor}`;
      }
    }

    return `Sur le thème "${theme}", on lit dans la trame : "${evidence || constat}". Qu'est-ce que cela recouvre concrètement aujourd'hui dans le fonctionnement réel, avec quels acteurs, quelles étapes et quel risque managérial derrière : "${risk}" ?${anchor}`;
  }

  if (params.iteration === 2) {
    switch (params.entryAngle) {
      case "causality":
        return `Si l'on creuse "${theme}", qu'est-ce qui produit réellement la situation suivante : "${constat}" ? Est-ce surtout un sujet de compétences, d'organisation, de décisions prises, d'arbitrages évités ou d'un mode de fonctionnement devenu fragile ?${anchor}`;
      case "arbitration":
        return `Sur "${theme}", où se situe le vrai problème d'arbitrage derrière le constat "${constat}" : qui décide, qui valide, où cela remonte, et en quoi cette chaîne entretient-elle le risque "${risk}" ?${anchor}`;
      case "dependency":
        return `Sur "${theme}", derrière le constat "${constat}", quelle dépendance pèse réellement le plus aujourd'hui : personne clé, expert rare, validateur obligé, relais insuffisant ou séquence fragile ? Et que produit cette dépendance dans les faits ?${anchor}`;
      case "economics":
        return `Sur "${theme}", derrière le constat "${constat}", où se loge l'impact économique réel : marge, coût, cash, sélectivité, rentabilité ou dérive non visible ? Comment cela se matérialise-t-il concrètement ?${anchor}`;
      case "formalization":
        return `Sur "${theme}", derrière le constat "${constat}", qu'est-ce qui manque vraiment pour piloter le sujet : rôle clair, rituel, méthode, indicateur, règle d'arbitrage ou point de contrôle ?${anchor}`;
      default:
        return `Si l'on creuse "${theme}", quel mécanisme concret explique aujourd'hui le constat "${constat}", et qu'est-ce qui maintient encore le risque "${risk}" ?${anchor}`;
    }
  }

  switch (params.entryAngle) {
    case "arbitration":
      return `Sur "${theme}", quel arbitrage reste aujourd'hui le moins tenu ou le moins explicite, et quel risque concret cela crée-t-il pour l'entreprise si rien ne change ? Qu'est-ce qu'il faudrait rendre clair ou objectivable en priorité ?${anchor}`;
    case "dependency":
      return `Sur "${theme}", quelle dépendance reste aujourd'hui la plus dangereuse, parce qu'elle tient sur trop peu de personnes, trop peu de relais ou un passage obligé ? Quel effet cela produit-il déjà, et qu'est-ce qu'il faudrait sécuriser en premier ?${anchor}`;
    case "economics":
      return `Sur "${theme}", quel point reste aujourd'hui le moins piloté sur le plan économique, et quel impact concret cela crée-t-il déjà sur la marge, le coût réel, le cash ou la rentabilité ? Qu'est-ce qu'il faudrait objectiver en priorité ?${anchor}`;
    case "formalization":
      return `Sur "${theme}", quel point reste aujourd'hui hors pilotage réel malgré le constat "${constat}" : absence de règle, de rôle, de rituel, d'indicateur ou de revue ? Quel risque concret cela crée-t-il, et qu'est-ce qu'il faudrait formaliser en premier ?${anchor}`;
    case "causality":
      return `Sur "${theme}", si vous isolez le point aujourd'hui le moins maîtrisé, quelle cause racine domine réellement derrière le constat "${constat}", et quel risque concret cela crée-t-il déjà pour l'entreprise ?${anchor}`;
    default:
      return `Sur "${theme}", quel point reste aujourd'hui le moins piloté dans le fonctionnement réel, et quel risque concret cela crée-t-il déjà pour l'entreprise ? Si vous deviez rendre ce point pilotable, qu'est-ce qu'il faudrait objectiver ou sécuriser en priorité ?${anchor}`;
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
    "Tu es un consultant senior en diagnostic dirigeant.",
    "Rédige UNE seule question, en français professionnel naturel.",
    "Objectif : obtenir une matière managériale utile, dense et exploitable.",
    "Contraintes impératives :",
    "- rester strictement sur le thème fourni",
    "- partir du constat et du risque managérial fournis",
    "- faire sentir le constat explicite puis le risque explicite, avant la question ouverte",
    "- poser une question qualitative, concrète, spécifique au thème réel",
    "- éclairer si utile les arbitrages, mécanismes, dépendances, défauts de pilotage ou zones non formalisées",
    "- ne pas demander artificiellement des chiffres",
    "- ne pas produire une question générique réutilisable sur n'importe quel thème",
    "- pour l'itération 3, bannir les formulations mécaniques du type 'insuffisamment clarifié / formalisé / sécurisé' si elles ne sont pas spécifiques au thème",
    "- répondre uniquement avec le texte de la question finale",
    "",
    "Forme attendue : une seule phrase interrogative, fluide, orientée dirigeant.",
    `Angle attendu : ${anglePrompt(params.entryAngle)}.`,
    `Dimension : ${params.dimensionId} — ${params.dimensionTitle}`,
    `Itération : ${params.iteration}/3 (${iterationObjective(params.iteration)})`,
    `Thème : ${normalizeText(params.theme)}`,
    `Constat : ${normalizeText(params.constat)}`,
    `Risque managérial : ${normalizeText(params.managerialRisk)}`,
    `Angle suggéré : ${params.entryAngle}`,
    `Signal d'absence : ${params.isAbsence ? "oui" : "non"}`,
    `Évidence trame : ${truncate(params.trameEvidence, 360) || "aucune citation utile"}`,
    `Faits déjà acquis : ${uniqueStrings((params.extractedFacts ?? []).map((item) => truncate(item, 170)), 4).join(" | ") || "aucun"}`,
    `Angles déjà couverts : ${uniqueStrings(params.coveredAngles ?? []).join(", ") || "aucun"}`,
    `Angles à éviter : ${uniqueStrings(params.rejectedAngles ?? []).join(", ") || "aucun"}`,
  ].join("\n");

  try {
    const response = await client.chat.completions.create({
      model: modelName(),
      temperature: 0.5,
      messages: [
        {
          role: "system",
          content:
            "Tu rédiges des questions de diagnostic dirigeant. Une seule question. Français professionnel naturel. Aucune liste. Aucun commentaire.",
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
