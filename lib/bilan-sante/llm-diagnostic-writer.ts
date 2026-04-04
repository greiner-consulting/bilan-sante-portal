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

function normalizeForMatch(value: unknown): string {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
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
    const key = normalizeForMatch(text);
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
      return "comprendre le fonctionnement réel sans surinterpréter";
    case 2:
      return "vérifier ou approfondir les hypothèses réellement utiles";
    case 3:
      return "consolider ce qui reste à clarifier, arbitrer ou objectiver";
    default:
      return "questionnement qualitatif";
  }
}

function anglePrompt(angle: EntryAngle): string {
  switch (angle) {
    case "causality":
      return "si pertinent, explorer ce qui explique réellement le sujet";
    case "arbitration":
      return "si pertinent, explorer qui décide ou arbitre réellement";
    case "economics":
      return "si pertinent, explorer la cohérence entre structure, volume, coût, marge ou rentabilité";
    case "formalization":
      return "si pertinent, explorer ce qui est réellement formalisé, suivi ou objectivé";
    case "dependency":
      return "si pertinent, explorer une dépendance réelle à une personne ou à un passage obligé";
    case "mechanism":
    default:
      return "décrire le fonctionnement réel ou le point utile à clarifier";
  }
}

function textIncludesAny(text: string, patterns: string[]): boolean {
  const normalized = normalizeForMatch(text);
  return patterns.some((pattern) => normalized.includes(normalizeForMatch(pattern)));
}

function looksLikeGrowthRecruitmentCase(text: string): boolean {
  return (
    textIncludesAny(text, ["croissance", "volume", "charge", "activité", "activite"]) &&
    textIncludesAny(text, ["recrut", "encadrement", "équipe", "equipe", "effectif", "staffing"])
  );
}

function looksLikeAdvanceStructureCase(text: string): boolean {
  return textIncludesAny(text, [
    "surdimension",
    "surdimensionné",
    "surdimensionne",
    "pour soutenir la croissance",
    "pas encore le volume",
    "pas encore la charge",
    "pas encore le niveau",
    "volume nécessaire",
    "volume necessaire",
    "avance de phase",
  ]);
}

function looksLikeRatherReassuringCase(text: string): boolean {
  return textIncludesAny(text, [
    "plutôt bon",
    "plutot bon",
    "assez bon",
    "satisfaisant",
    "correct",
    "suivi",
    "on suit",
    "bon niveau",
    "bonne tenue",
    "peu de pertes de temps",
    "limiter les pertes de temps",
    "ça fonctionne",
    "cela fonctionne",
  ]);
}

function looksLikeCurrentVsFutureSplit(text: string): boolean {
  return (
    textIncludesAny(text, [
      "aujourd'hui",
      "actuellement",
      "pour l'instant",
      "à date",
      "a date",
      "les experts actuels",
      "les équipes actuelles",
      "les ressources actuelles",
      "permettent de répondre aux besoins",
      "suffisent aujourd'hui",
      "tiennent aujourd'hui",
    ]) &&
    textIncludesAny(text, [
      "mais",
      "en revanche",
      "à condition que",
      "a condition que",
      "si",
      "demain",
      "plus tard",
      "à terme",
      "a terme",
      "dans le futur",
      "nécessitera",
      "necessitera",
      "nécessiterait",
      "necessiterait",
    ])
  );
}

function looksLikeConditionalNeedCase(text: string): boolean {
  return (
    textIncludesAny(text, [
      "contrat structurant",
      "nouveau contrat",
      "gros contrat",
      "si le contrat se concrétise",
      "si le contrat se concretise",
      "si la croissance se confirme",
      "si la croissance arrive",
      "si le volume augmente",
      "si la charge augmente",
      "à partir d'un certain volume",
      "a partir d'un certain volume",
    ]) &&
    textIncludesAny(text, [
      "recrut",
      "renfort",
      "embauche",
      "profils",
      "effectif",
      "ressources supplémentaires",
      "ressources supplementaires",
      "besoin de recruter",
    ])
  );
}

function riskLooksGeneric(risk: string): boolean {
  const text = normalizeForMatch(risk);
  return [
    "pilotage incomplet",
    "dependance excessive",
    "dépendance excessive",
    "arbitrage insuffisamment maitrise",
    "arbitrage insuffisamment maîtrisé",
    "risque managérial",
    "pilotage insuffisamment fonde",
    "pilotage insuffisamment fondé",
  ].some((pattern) => text.includes(normalizeForMatch(pattern)));
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
  const evidence = truncate(params.trameEvidence, 170);
  const fact = truncate(params.facts?.[0], 150);
  const prudentRisk = !riskLooksGeneric(params.managerialRisk)
    ? truncate(params.managerialRisk, 170)
    : "";
  const anchor = fact ? ` Vous avez déjà indiqué par exemple : "${fact}".` : "";
  const combinedText = normalizeForMatch([theme, constat, evidence, prudentRisk].join(" | "));

  if (params.iteration === 1) {
    if (params.isAbsence) {
      return `Sur "${theme}", comment ce sujet est-il géré concrètement aujourd'hui ?${anchor}`;
    }

    if (
      looksLikeCurrentVsFutureSplit(combinedText) ||
      looksLikeConditionalNeedCase(combinedText)
    ) {
      return `Sur "${theme}", avez-vous déjà identifié à partir de quel type de contrat ou de quel niveau de volume ces recrutements deviendraient nécessaires ?${anchor}`;
    }

    if (looksLikeGrowthRecruitmentCase(combinedText) && looksLikeAdvanceStructureCase(combinedText)) {
      return `Sur "${theme}", sur quels volumes ou quelles perspectives avez-vous dimensionné cet encadrement aujourd'hui ?${anchor}`;
    }

    if (looksLikeRatherReassuringCase(combinedText)) {
      return `Sur "${theme}", qu'est-ce qui vous fait dire aujourd'hui que le sujet tient plutôt bien ?${anchor}`;
    }

    if (normalizeForMatch(evidence).includes("croissance") && normalizeForMatch(evidence).includes("recrut")) {
      return `Sur "${theme}", avez-vous déjà identifié à partir de quel niveau de croissance vous devrez recruter ?${anchor}`;
    }

    return `Sur "${theme}", qu'est-ce que cela veut dire concrètement aujourd'hui : "${truncate(evidence || constat, 130)}" ?${anchor}`;
  }

  if (params.iteration === 2) {
    if (
      looksLikeCurrentVsFutureSplit(combinedText) ||
      looksLikeConditionalNeedCase(combinedText)
    ) {
      return `Sur "${theme}", quels profils ou quelles compétences faudrait-il renforcer si ce seuil était franchi ?${anchor}`;
    }

    if (looksLikeGrowthRecruitmentCase(combinedText) && looksLikeAdvanceStructureCase(combinedText)) {
      return `Sur "${theme}", à partir de quel niveau de charge ou de volume cet encadrement sera-t-il pleinement justifié ?${anchor}`;
    }

    if (looksLikeRatherReassuringCase(combinedText)) {
      return `Sur "${theme}", dans quel cas ce bon niveau pourrait-il devenir plus fragile ?${anchor}`;
    }

    switch (params.entryAngle) {
      case "causality":
        return `Sur "${theme}", quelle est selon vous la cause principale de ce point ?${anchor}`;
      case "arbitration":
        return `Sur "${theme}", qui arbitre réellement ce point aujourd'hui ?${anchor}`;
      case "dependency":
        return `Sur "${theme}", ce sujet dépend-il encore trop de quelques personnes ?${anchor}`;
      case "economics":
        return `Sur "${theme}", quel impact concret voyez-vous aujourd'hui sur la charge, le coût ou la rentabilité ?${anchor}`;
      case "formalization":
        return `Sur "${theme}", qu'est-ce qui est réellement formalisé aujourd'hui ?${anchor}`;
      default:
        return `Sur "${theme}", qu'est-ce qu'il faut clarifier ou vérifier en priorité ?${anchor}`;
    }
  }

  if (
    looksLikeCurrentVsFutureSplit(combinedText) ||
    looksLikeConditionalNeedCase(combinedText)
  ) {
    return `Sur "${theme}", qu'est-ce qui reste aujourd'hui le moins préparé si cette montée en charge se concrétise ?${anchor}`;
  }

  if (looksLikeGrowthRecruitmentCase(combinedText) && looksLikeAdvanceStructureCase(combinedText)) {
    return `Sur "${theme}", quel est aujourd'hui le principal point à objectiver entre structure en place, volume réel et croissance attendue ?${anchor}`;
  }

  if (looksLikeRatherReassuringCase(combinedText)) {
    return `Sur "${theme}", quel point mérite malgré tout d'être gardé sous vigilance ?${anchor}`;
  }

  switch (params.entryAngle) {
    case "arbitration":
      return `Sur "${theme}", quel arbitrage reste aujourd'hui le moins clair ?${anchor}`;
    case "dependency":
      return `Sur "${theme}", quelle dépendance reste aujourd'hui la plus sensible ?${anchor}`;
    case "economics":
      return `Sur "${theme}", quel point reste aujourd'hui le moins objectivé sur le plan économique ?${anchor}`;
    case "formalization":
      return `Sur "${theme}", qu'est-ce qui n'est pas suffisamment objectivé aujourd'hui ?${anchor}`;
    case "causality":
      return `Sur "${theme}", quelle hypothèse principale reste aujourd'hui à confirmer ?${anchor}`;
    default:
      return `Sur "${theme}", quel est aujourd'hui le principal point à sécuriser ou objectiver ?${anchor}`;
  }
}

function normalizeQuestionOutput(value: unknown, fallback: string): string {
  const text = normalizeText(value);
  if (!text) return fallback;
  if (/[?؟]$/.test(text)) return text;
  return `${text}?`;
}

type QuestionDecisionShape = {
  assessmentLevel?: "strong_signal" | "moderate_signal" | "weak_signal" | "reassuring_signal";
  workingHypothesis?: string;
  question?: string;
};

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

  const combinedText = normalizeForMatch(
    [
      params.theme,
      params.constat,
      params.managerialRisk,
      params.trameEvidence,
      ...(params.extractedFacts ?? []),
    ].join(" | ")
  );

  const specialCaseInstruction =
    looksLikeGrowthRecruitmentCase(combinedText) && looksLikeAdvanceStructureCase(combinedText)
      ? [
          "Cas métier détecté : structure ou encadrement en avance par rapport au volume réel / à la croissance attendue.",
          "Dans ce cas, la question doit viser la justification du dimensionnement, le seuil de volume, la montée en charge ou l'hypothèse retenue.",
          "Ne pas basculer vers une question de formalisation si le vrai sujet est la cohérence entre structure, volume réel et croissance attendue.",
        ].join("\n")
      : looksLikeCurrentVsFutureSplit(combinedText) || looksLikeConditionalNeedCase(combinedText)
      ? [
          "Cas métier détecté : la matière oppose une situation actuelle tenue à un besoin futur conditionnel.",
          "Dans ce cas, la question doit obligatoirement porter sur le seuil, le déclencheur, les profils à renforcer ou le niveau de préparation.",
          "Ne pas revenir à une question générique de thème.",
          "Ne pas demander 'comment cela fonctionne aujourd'hui' si le constat porte déjà sur une bascule actuelle versus future.",
        ].join("\n")
      : looksLikeRatherReassuringCase(combinedText)
      ? [
          "Cas métier détecté : matière plutôt rassurante ou déjà assez bien tenue.",
          "Dans ce cas, ne pas fabriquer un faux risque.",
          "Poser plutôt une question simple de confirmation, de limite ou de vigilance résiduelle.",
        ].join("\n")
      : "";

  const prompt = [
    "Tu es un consultant senior en diagnostic dirigeant.",
    "Tu dois décider d'abord s'il y a vraiment un sujet fort, un sujet faible, un sujet plutôt rassurant ou simplement un point à vérifier.",
    "Ensuite seulement, tu rédiges UNE seule question.",
    "",
    "Objectif : obtenir une matière managériale utile, naturelle, crédible et exploitable.",
    "",
    "Règles impératives :",
    "- partir d'abord du constat, de l'évidence trame et des faits déjà acquis",
    "- ne pas inventer de risque s'il n'est pas réellement suggéré par la matière",
    "- si la matière est plutôt rassurante, poser une question simple de confirmation ou de limite",
    "- si la matière est ambiguë, poser une question prudente de clarification",
    "- si la matière révèle un vrai sujet, poser une question ciblée d'approfondissement",
    "- ne jamais extrapoler sans preuve vers dépendance excessive, arbitrage défaillant ou pilotage incomplet",
    "- rester strictement sur le thème fourni",
    "- poser une seule question",
    "- question courte, claire, concrète, directement compréhensible par un dirigeant",
    "- ne pas produire une question générique réutilisable sur n'importe quel thème",
    "- ne pas commenter, ne pas expliquer, ne pas ajouter d'introduction",
    "",
    "Quand le sujet porte sur une structure, un encadrement, un recrutement ou des ressources dimensionnés pour une croissance future, la bonne question porte d'abord sur :",
    "- les volumes réels",
    "- les hypothèses retenues",
    "- le seuil de montée en charge",
    "- la justification économique ou opérationnelle du dimensionnement",
    "",
    specialCaseInstruction,
    "",
    "Réponds en JSON strict avec :",
    '- assessmentLevel: "strong_signal" | "moderate_signal" | "weak_signal" | "reassuring_signal"',
    "- workingHypothesis: courte hypothèse prudente",
    "- question: la question finale",
    "",
    `Angle indicatif : ${anglePrompt(params.entryAngle)}.`,
    `Dimension : ${params.dimensionId} — ${params.dimensionTitle}`,
    `Itération : ${params.iteration}/3 (${iterationObjective(params.iteration)})`,
    `Thème : ${normalizeText(params.theme)}`,
    `Constat : ${normalizeText(params.constat)}`,
    `Risque fourni (à utiliser seulement s'il est vraiment utile) : ${normalizeText(params.managerialRisk)}`,
    `Signal d'absence : ${params.isAbsence ? "oui" : "non"}`,
    `Évidence trame : ${truncate(params.trameEvidence, 360) || "aucune citation utile"}`,
    `Faits déjà acquis : ${uniqueStrings((params.extractedFacts ?? []).map((item) => truncate(item, 170)), 4).join(" | ") || "aucun"}`,
    `Angles déjà couverts : ${uniqueStrings(params.coveredAngles ?? []).join(", ") || "aucun"}`,
    `Angles à éviter : ${uniqueStrings(params.rejectedAngles ?? []).join(", ") || "aucun"}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const response = await client.chat.completions.create({
      model: modelName(),
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Tu rédiges des questions de diagnostic dirigeant. Tu décides d'abord si le sujet est fort, faible, rassurant ou simplement à vérifier. Tu ne fabriques pas de faux risque. Tu réponds uniquement en JSON valide.",
        },
        { role: "user", content: prompt },
      ],
    });

    const raw = normalizeText(response.choices[0]?.message?.content);
    const parsed = jsonParse<QuestionDecisionShape>(raw);

    if (!parsed?.question) {
      return fallback;
    }

    return normalizeQuestionOutput(parsed.question, fallback);
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