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

function stripQuotes(value: string): string {
  return normalizeText(value).replace(/["“”«»]/g, "").trim();
}

function extractEvidenceFocus(params: {
  trameEvidence?: string;
  facts?: string[];
  constat?: string;
}): string {
  const candidate = uniqueStrings([
    stripQuotes(truncate(params.trameEvidence, 110)),
    ...(params.facts ?? []).map((item) => stripQuotes(truncate(item, 110))),
    stripQuotes(truncate(params.constat, 110)),
  ], 1)[0];

  return candidate ?? "";
}

function sourceSuggestsFutureFragility(params: {
  constat?: string;
  trameEvidence?: string;
  managerialRisk?: string;
}): boolean {
  const text = normalizeForMatch(
    [params.constat, params.trameEvidence, params.managerialRisk].filter(Boolean).join(" | ")
  );

  return [
    "si la croissance",
    "si un contrat",
    "si cela arrive",
    "venait a manquer",
    "venait à manquer",
    "en cas de croissance",
    "en cas d acceleration",
    "en cas d'acceleration",
    "montee en charge",
    "montée en charge",
    "aurons besoin",
    "aura besoin",
    "besoin de recruter",
    "si la charge augmente",
    "si le volume double",
  ].some((pattern) => text.includes(normalizeForMatch(pattern)));
}

function questionLooksTooGeneric(value: string): boolean {
  const text = normalizeForMatch(value);
  return [
    "comment cela se passe-t-il concretement aujourd'hui",
    "qu'est-ce qui explique surtout la situation actuelle",
    "quel est aujourd'hui le point le moins maitrise",
    "qu'est-ce qui n'est pas assez cadre aujourd'hui",
    "qu'est-ce qui manque surtout pour piloter correctement le sujet",
    "qu'est-ce qui empeche vos equipes de bien comprendre",
    "qu'est-ce qui empeche vos equipes de bien suivre",
    "quel serait le premier frein",
    "quel est aujourd'hui le point le moins pilote",
    "quel est le point precis ou",
    "premier obstacle concret qui pourrait",
    "quelle est la premiere difficulte qui se presente",
    "qu'est-ce qui n'est pas encore pret aujourd'hui pour tenir une montee en charge",
    "qu'est-ce qui risque de bloquer d'abord",
  ].some((pattern) => text.includes(normalizeForMatch(pattern)));
}

function questionLooksTooHypothetical(value: string): boolean {
  const text = normalizeForMatch(value);
  return (
    text.startsWith("si ") ||
    text.startsWith("en cas de ") ||
    text.includes("quel serait") ||
    text.includes("que se passerait-il")
  );
}

function questionTooCloseToPrior(value: string, priorQuestionText?: string | null): boolean {
  const current = normalizeForMatch(value);
  const prior = normalizeForMatch(priorQuestionText);
  if (!current || !prior) return false;
  if (current === prior) return true;

  const currentTokens = new Set(
    current.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean)
  );
  const priorTokens = new Set(
    prior.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean)
  );
  if (currentTokens.size === 0 || priorTokens.size === 0) return false;

  let intersection = 0;
  for (const token of currentTokens) {
    if (priorTokens.has(token)) intersection += 1;
  }
  const union = new Set([...currentTokens, ...priorTokens]).size;
  return union > 0 && intersection / union >= 0.58;
}

function buildConcreteLead(theme: string, focus: string): string {
  const safeTheme = normalizeText(theme);
  const safeFocus = normalizeText(focus);
  if (safeFocus) {
    return `Sur "${safeTheme}", quand on regarde "${safeFocus}", `;
  }
  return `Sur "${safeTheme}", `;
}

function groundingTokens(value: string | null | undefined): string[] {
  const stopWords = new Set([
    "sur",
    "dans",
    "avec",
    "pour",
    "vous",
    "votre",
    "vos",
    "des",
    "les",
    "une",
    "qui",
    "quoi",
    "quand",
    "cela",
    "comme",
    "plus",
    "moins",
    "encore",
    "aujourd",
    "hui",
    "point",
    "precis",
    "réelle",
    "reelle",
    "faits",
    "theme",
    "thème",
    "charge",
    "activite",
    "activité",
    "montee",
    "montée",
  ]);

  return normalizeForMatch(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !stopWords.has(token));
}

function questionUsesGrounding(params: {
  candidate: string;
  focus: string;
  trameEvidence?: string;
  facts?: string[];
}): boolean {
  const candidate = normalizeForMatch(params.candidate);
  if (!candidate) return true;

  const tokens = uniqueStrings([
    ...groundingTokens(params.focus),
    ...groundingTokens(params.trameEvidence),
    ...(params.facts ?? []).flatMap((item) => groundingTokens(item)),
  ]).slice(0, 8);

  if (tokens.length === 0) return true;
  return tokens.some((token) => candidate.includes(token));
}

function buildFocusSpecificQuestion(params: {
  iteration: IterationNumber;
  entryAngle: EntryAngle;
  focus: string;
  trameEvidence?: string;
}): string | null {
  const focus = normalizeText(params.focus);
  const source = normalizeForMatch([focus, params.trameEvidence].filter(Boolean).join(" | "));
  if (!focus) return null;

  if ((source.includes("prevision") || source.includes("prévision")) && source.includes("6 mois")) {
    return "Quand on regarde la prévision à 6 mois, qu’est-ce qui vous manque aujourd’hui pour la rendre fiable ?";
  }

  if ((source.includes("4 semaines") || source.includes("5 semaines")) && source.includes("6 mois")) {
    return "Qu’est-ce qui rend aujourd’hui la prévision à moyen terme plus difficile que celle à quelques semaines ?";
  }

  if (source.includes("recrut") || source.includes("integr") || source.includes("onboarding")) {
    if (params.iteration === 1) {
      return "Quand un nouveau recruté arrive, qu’est-ce qui empêche aujourd’hui de sécuriser correctement son intégration ?";
    }
    if (params.iteration === 2) {
      return "Entre trouver, recruter et intégrer, où perdez-vous le plus de temps aujourd’hui ?";
    }
    return "Quand un recruté arrive, quelle étape reste encore la moins sécurisée aujourd’hui ?";
  }

  if (
    source.includes("depart") ||
    source.includes("départ") ||
    source.includes("demission") ||
    source.includes("démission") ||
    source.includes("absence") ||
    source.includes("absente") ||
    source.includes("turnover")
  ) {
    return "Quand un salarié clé s’absente ou part, qu’est-ce qui bloque d’abord concrètement dans l’équipe ?";
  }

  if (source.includes("diversification") || source.includes("strategie") || source.includes("stratégie")) {
    return "Sur la diversification, qu’est-ce qui n’est pas assez clair ou relayé aujourd’hui pour les équipes ?";
  }

  if (source.includes("charge") && (source.includes("planif") || source.includes("prevision") || source.includes("prévision"))) {
    return "Quand on regarde ce pilotage de charge, qu’est-ce qui est bien tenu à court terme mais décroche ensuite ?";
  }

  if (params.iteration === 1 && params.entryAngle === "formalization") {
    return `Quand on regarde "${focus}", qu’est-ce qui n’est pas assez cadré aujourd’hui ?`;
  }

  if (params.iteration === 1 && params.entryAngle === "dependency") {
    return `Quand on regarde "${focus}", sur qui ou sur quoi cela repose concrètement aujourd’hui ?`;
  }

  if (params.iteration >= 2 && params.entryAngle === "formalization") {
    return `Quand on regarde "${focus}", qu’est-ce qui se fait encore sans règle claire ou sans support formalisé ?`;
  }

  if (params.iteration >= 2 && params.entryAngle === "dependency") {
    return `Quand on regarde "${focus}", sur qui devez-vous encore vous appuyer pour que cela avance ?`;
  }

  return null;
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
  evidenceFocus?: string;
}): string {
  const theme = normalizeText(params.theme);
  const constat = normalizeText(params.constat);
  const focus = normalizeText(params.evidenceFocus) || extractEvidenceFocus({
    trameEvidence: params.trameEvidence,
    facts: params.facts,
    constat,
  });
  const preciseLead = buildConcreteLead(theme, focus);
  const futureFragility = sourceSuggestsFutureFragility({
    constat,
    trameEvidence: params.trameEvidence,
    managerialRisk: params.managerialRisk,
  });

  const focusSpecific = buildFocusSpecificQuestion({
    iteration: params.iteration,
    entryAngle: params.entryAngle,
    focus,
    trameEvidence: params.trameEvidence,
  });
  if (focusSpecific) return focusSpecific;

  if (params.iteration === 1) {
    if (params.isAbsence) {
      switch (params.entryAngle) {
        case "dependency":
          return `${preciseLead}de qui ou de quoi dépendez-vous le plus aujourd’hui ?`;
        case "arbitration":
          return `${preciseLead}qui tranche réellement quand il faut décider ?`;
        case "economics":
          return `${preciseLead}quel impact concret voyez-vous aujourd’hui sur le coût, la marge ou le cash ?`;
        case "formalization":
          return `${preciseLead}qu’est-ce qui n’est pas assez cadré aujourd’hui ?`;
        default:
          return `${preciseLead}comment cela se passe-t-il concrètement aujourd’hui ?`;
      }
    }

    if (futureFragility) {
      switch (params.entryAngle) {
        case "dependency":
          return `${preciseLead}sur qui repose aujourd’hui la capacité à suivre si l’activité monte ?`;
        case "formalization":
          return `${preciseLead}qu’est-ce qui n’est pas prêt aujourd’hui pour absorber une hausse d’activité ?`;
        default:
          return `${preciseLead}qu’est-ce qui n’est pas encore prêt aujourd’hui pour tenir une montée en charge ?`;
      }
    }

    switch (params.entryAngle) {
      case "dependency":
        return `${preciseLead}sur qui ou sur quoi cela repose concrètement ?`;
      case "arbitration":
        return `${preciseLead}qui tranche réellement et sur quelle base ?`;
      case "economics":
        return `${preciseLead}quel impact concret cela a-t-il aujourd’hui sur le coût, la marge ou le cash ?`;
      case "formalization":
        return `${preciseLead}qu’est-ce qui est cadré et qu’est-ce qui ne l’est pas assez aujourd’hui ?`;
      default:
        return `${preciseLead}comment cela se passe-t-il concrètement aujourd’hui ?`;
    }
  }

  if (params.iteration === 2) {
    if (futureFragility) {
      switch (params.entryAngle) {
        case "dependency":
          return `${preciseLead}si la charge monte vite, quel relais ou quelle personne devient indispensable ?`;
        case "formalization":
          return `${preciseLead}si l’activité accélère, qu’est-ce qui n’est pas assez cadré pour tenir le rythme ?`;
        default:
          return `${preciseLead}si l’activité accélère, où apparaît le premier frein concret ?`;
      }
    }

    switch (params.entryAngle) {
      case "causality":
        return `${preciseLead}qu’est-ce qui bloque ou explique le plus cette situation dans les faits ?`;
      case "arbitration":
        return `${preciseLead}qui décide réellement et à quel moment cela remonte ?`;
      case "dependency":
        return `${preciseLead}sur qui devez-vous encore vous appuyer pour que cela avance ?`;
      case "economics":
        return `${preciseLead}où voyez-vous concrètement l’effet sur le coût, la marge ou le cash ?`;
      case "formalization":
        return `${preciseLead}qu’est-ce qui se fait encore sans règle claire ou sans support formalisé ?`;
      default:
        return `${preciseLead}qu’est-ce qui coince concrètement aujourd’hui ?`;
    }
  }

  if (futureFragility) {
    switch (params.entryAngle) {
      case "dependency":
        return `${preciseLead}si la personne clé manque, qu’est-ce qui s’arrête ou ralentit d’abord ?`;
      case "economics":
        return `${preciseLead}si l’activité accélère, quel repère vous manquera pour voir la dérive à temps ?`;
      default:
        return `${preciseLead}si l’activité accélère, quel point restera le plus fragile ?`;
    }
  }

  switch (params.entryAngle) {
    case "arbitration":
      return `${preciseLead}quel arbitrage remonte encore jusqu’à vous aujourd’hui ?`;
    case "dependency":
      return `${preciseLead}qu’est-ce qui ne tourne pas correctement sans la personne ou le relais clé ?`;
    case "economics":
      return `${preciseLead}quel repère vous manque encore pour voir la dérive à temps ?`;
    case "formalization":
      return `${preciseLead}qu’est-ce qui reste encore géré à l’oral ou au cas par cas ?`;
    case "causality":
      return `${preciseLead}quelle cause de fond n’est toujours pas traitée aujourd’hui ?`;
    default:
      return `${preciseLead}quel point reste encore le moins sécurisé aujourd’hui ?`;
  }
}

function normalizeQuestionOutput(value: unknown, fallback: string): string {
  const text = normalizeText(value);
  if (!text) return fallback;
  if (/[?؟]$/.test(text)) return text;
  return `${text}?`;
}

function shouldFallbackToConcreteQuestion(params: {
  candidate: string;
  fallback: string;
  iteration: IterationNumber;
  constat: string;
  trameEvidence?: string;
  managerialRisk: string;
  priorQuestionText?: string | null;
  focus: string;
  facts?: string[];
}): boolean {
  if (questionLooksTooGeneric(params.candidate)) return true;
  if (questionTooCloseToPrior(params.candidate, params.priorQuestionText)) return true;

  const futureFragility = sourceSuggestsFutureFragility({
    constat: params.constat,
    trameEvidence: params.trameEvidence,
    managerialRisk: params.managerialRisk,
  });

  if (params.iteration === 1 && questionLooksTooHypothetical(params.candidate)) {
    return true;
  }

  if (params.iteration >= 2 && !futureFragility && questionLooksTooHypothetical(params.candidate)) {
    return true;
  }

  if (
    normalizeText(params.focus) &&
    !questionUsesGrounding({
      candidate: params.candidate,
      focus: params.focus,
      trameEvidence: params.trameEvidence,
      facts: params.facts,
    })
  ) {
    return true;
  }

  const candidateNormalized = normalizeForMatch(params.candidate);
  const fallbackNormalized = normalizeForMatch(params.fallback);
  if (candidateNormalized === fallbackNormalized) return false;

  if (
    params.iteration >= 2 &&
    !futureFragility &&
    [
      "bien comprendre",
      "bien suivre",
      "point le moins maitrise",
      "point le moins pilote",
      "premier frein",
      "obstacle concret qui pourrait",
    ].some((pattern) => candidateNormalized.includes(normalizeForMatch(pattern)))
  ) {
    return true;
  }

  return false;
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
  evidenceFocus?: string | null;
  priorQuestionText?: string | null;
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
    evidenceFocus: params.evidenceFocus ?? undefined,
  });

  const client = getClient();
  if (!client) return fallback;

  const focus = normalizeText(params.evidenceFocus) || extractEvidenceFocus({
    trameEvidence: params.trameEvidence,
    facts: params.extractedFacts,
    constat: params.constat,
  });
  const futureFragility = sourceSuggestsFutureFragility({
    constat: params.constat,
    trameEvidence: params.trameEvidence,
    managerialRisk: params.managerialRisk,
  });

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
    "- t'appuyer explicitement sur le point d'appui concret fourni ci-dessous",
    "- réutiliser, quand c'est possible, le vocabulaire du point d'appui concret plutôt que des notions générales comme montée en charge, obstacle, difficulté ou compréhension",
    "- privilégier une scène réelle, un geste de pilotage, une décision, un blocage concret ou un fait d'exécution observable",
    "- en itération 1, repartir d'abord du fonctionnement actuel ou d'un fait déjà visible ; éviter les scénarios hypothétiques",
    "- en itération 2 et 3, partir d'abord du fonctionnement réel aujourd'hui ; n'utiliser un scénario hypothétique que si le constat ou l'évidence parle explicitement d'une fragilité future",
    "- ne pas réécrire le constat dans la question",
    "- ne pas réécrire le risque dans la question",
    "- ne pas utiliser de préambule théorique",
    "- bannir les formulations du type : 'dans un contexte où', 'afin de', 'en tenant compte de', 'comment anticipez-vous efficacement'",
    "- bannir les questions génériques qui pourraient s’appliquer à n’importe quel thème",
    "- éviter de reposer une question trop proche de la dernière question déjà posée sur ce thème",
    "- privilégier des formulations comme :",
    '  * "Quand on regarde ..., qui décide réellement ?" ',
    '  * "Sur ..., qu’est-ce qui se fait encore sans règle claire ?" ',
    '  * "Sur ..., sur qui devez-vous encore vous appuyer ?" ',
    '  * "Quand on regarde la prévision à 6 mois, qu’est-ce qui vous manque pour la fiabiliser ?" ',
    '  * "Quand un recruté arrive, qu’est-ce qui empêche de sécuriser correctement son intégration ?" ',
    "",
    "Exemples à éviter :",
    '  * "Quel serait le premier frein ... ?" sauf si l’évidence parle explicitement d’un risque futur',
    '  * "Qu’est-ce qui explique surtout la situation actuelle ?"',
    '  * "Qu’est-ce qui empêche vos équipes de bien comprendre ... ?"',
    '  * "Quel est aujourd’hui le point le moins maîtrisé ?" si une formulation plus concrète est possible',
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
    `Fragilité future explicitement présente dans la matière : ${futureFragility ? "oui" : "non"}`,
    `Point d'appui concret : ${focus || "aucun point d'appui concret exploitable"}`,
    `Évidence trame : ${truncate(params.trameEvidence, 360) || "aucune citation utile"}`,
    `Faits déjà acquis : ${uniqueStrings((params.extractedFacts ?? []).map((item) => truncate(item, 170)), 4).join(" | ") || "aucun"}`,
    `Dernière question déjà posée sur ce thème : ${truncate(params.priorQuestionText, 220) || "aucune"}`,
    `Angles déjà couverts : ${uniqueStrings(params.coveredAngles ?? []).join(", ") || "aucun"}`,
    `Angles à éviter : ${uniqueStrings(params.rejectedAngles ?? []).join(", ") || "aucun"}`,
  ].join("\n");

  try {
    const response = await client.chat.completions.create({
      model: modelName(),
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content:
            "Tu rédiges des questions de diagnostic dirigeant. Une seule question. Français naturel, concret, direct. Pas de formule générique. Réutilise les objets concrets de la matière fournie. Pas de contrefactuel si la matière ne le justifie pas. Aucun commentaire.",
        },
        { role: "user", content: prompt },
      ],
    });

    const candidate = normalizeQuestionOutput(response.choices[0]?.message?.content, fallback);
    if (
      shouldFallbackToConcreteQuestion({
        candidate,
        fallback,
        iteration: params.iteration,
        constat: params.constat,
        trameEvidence: params.trameEvidence,
        managerialRisk: params.managerialRisk,
        priorQuestionText: params.priorQuestionText,
        focus,
        facts: params.extractedFacts,
      })
    ) {
      return fallback;
    }
    return candidate;
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