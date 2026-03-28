// lib/bilan-sante/answer-analyzer.ts

type AnalyzerQuestionContext = {
  theme?: string | null;
  constat?: string | null;
  questionOuverte?: string | null;
  entryAngle?: string | null;
};

export type AnswerIntent =
  | "business_answer"
  | "reframing"
  | "clarification_request"
  | "challenge"
  | "mixed"
  | "noise";

export type AnalyzerAction =
  | "store_answer"
  | "store_and_pivot"
  | "rephrase_question"
  | "ask_for_examples"
  | "challenge_same_topic";

export type RootCauseCategory =
  | "skills"
  | "experience"
  | "decision"
  | "arbitration"
  | "organization"
  | "resources"
  | "pricing"
  | "commercial"
  | "execution"
  | "quality"
  | "cash";

export type SuggestedAngle =
  | "causality"
  | "arbitration"
  | "economics"
  | "formalization"
  | "dependency"
  | "mechanism";

export interface AnswerAnalysis {
  rawMessage: string;
  cleanedMessage: string;
  intent: AnswerIntent;
  action: AnalyzerAction;
  confidence: number;

  isUsableBusinessMatter: boolean;
  shouldStoreAsAnswer: boolean;
  shouldRephraseQuestion: boolean;
  shouldPivotAngle: boolean;

  summary: string;
  rationale: string;

  extractedFacts: string[];
  reframingSignals: string[];
  contradictionSignals: string[];
  detectedRootCauses: RootCauseCategory[];
  suggestedAngle: SuggestedAngle | null;
  suggestedFollowUp: string | null;
}

const CLARIFICATION_PATTERNS = [
  "je ne comprends pas",
  "j ai pas compris",
  "j'ai pas compris",
  "ce n est pas clair",
  "ce n'est pas clair",
  "pas clair",
  "peux tu reformuler",
  "peux-tu reformuler",
  "reformule",
  "pouvez vous reformuler",
  "pouvez-vous reformuler",
  "je ne vois pas",
  "je ne saisis pas",
  "question incomprehensible",
  "question incompréhensible",
  "je ne comprends pas la question",
];

const CHALLENGE_PATTERNS = [
  "vous vous trompez",
  "tu te trompes",
  "ce n est pas le sujet",
  "ce n'est pas le sujet",
  "ce n est pas le bon sujet",
  "ce n'est pas le bon sujet",
  "ce n est pas un probleme de",
  "ce n'est pas un problème de",
  "je ne suis pas d accord",
  "je ne suis pas d'accord",
  "ce diagnostic est faux",
  "ce n est pas exact",
  "ce n'est pas exact",
  "ce n est pas la vraie cause",
  "ce n'est pas la vraie cause",
  "vous partez du mauvais angle",
  "tu pars du mauvais angle",
];

const REFRAMING_PATTERNS = [
  "c est plutot",
  "c'est plutôt",
  "c est surtout",
  "c'est surtout",
  "en realite",
  "en réalité",
  "le vrai sujet",
  "le sujet c est",
  "le sujet c'est",
  "il faut plutot regarder",
  "il faut plutôt regarder",
  "c est davantage",
  "c'est davantage",
  "il s agit plutot de",
  "il s'agit plutôt de",
  "plus exactement",
];

const CONTINUATION_PATTERNS = [
  "idem",
  "pareil",
  "meme chose",
  "même chose",
  "comme avant",
  "toujours pareil",
  "oui c est ca",
  "oui c'est ça",
  "oui exactement",
  "exactement",
  "c est ca",
  "c'est ça",
  "surtout",
  "notamment",
  "en particulier",
];

const BUSINESS_CONNECTORS = [
  "parce que",
  "car",
  "notamment",
  "en pratique",
  "aujourd hui",
  "aujourd'hui",
  "du fait de",
  "en raison de",
  "concretement",
  "concrètement",
  "par exemple",
  "depuis",
  "quand",
  "comme",
  "mais",
  "notre",
  "chez nous",
];

const ROOT_CAUSE_KEYWORDS: Record<RootCauseCategory, string[]> = {
  skills: [
    "competence",
    "compétence",
    "competences",
    "compétences",
    "niveau",
    "savoir-faire",
    "maitrise",
    "maîtrise",
    "formation",
  ],
  experience: [
    "experience",
    "expérience",
    "seniorite",
    "séniorité",
    "junior",
    "senior",
    "retour d experience",
    "retour d'expérience",
  ],
  decision: [
    "decision",
    "décision",
    "decisions",
    "décisions",
    "mauvais choix",
    "erreur",
    "orientation",
    "priorite",
    "priorité",
  ],
  arbitration: [
    "validation",
    "arbitrage",
    "autorisation",
    "qui decide",
    "qui décide",
    "comite",
    "comité",
    "escalade",
  ],
  organization: [
    "organisation",
    "organigramme",
    "roles",
    "rôles",
    "responsabilites",
    "responsabilités",
    "coordination",
    "pilotage",
    "management",
    "methode",
    "méthode",
    "cadre",
    "processus",
    "formalise",
    "formalisé",
    "formaliser",
    "habitude",
    "chef de projet",
    "chefs de projet",
  ],
  resources: [
    "ressources",
    "charge",
    "capacite",
    "capacité",
    "effectif",
    "sous-effectif",
    "disponibilite",
    "disponibilité",
    "temps",
  ],
  pricing: [
    "prix",
    "tarif",
    "chiffrage",
    "devis",
    "marge",
    "rentabilite",
    "rentabilité",
    "cout",
    "coût",
  ],
  commercial: [
    "commercial",
    "prospection",
    "pipeline",
    "conversion",
    "marche",
    "marché",
    "positionnement",
    "offre",
    "client",
  ],
  execution: [
    "execution",
    "exécution",
    "production",
    "delai",
    "délai",
    "planning",
    "qualite de realisation",
    "qualité de réalisation",
    "livraison",
  ],
  quality: [
    "qualite",
    "qualité",
    "non-qualite",
    "non qualité",
    "erreur",
    "reprise",
    "conformite",
    "conformité",
    "incident",
  ],
  cash: [
    "cash",
    "tresorerie",
    "trésorerie",
    "resultat",
    "résultat",
    "ebitda",
    "rentabilite",
    "rentabilité",
    "marge",
  ],
};

const BUSINESS_FRAGMENT_HINTS = uniqueStaticStrings([
  ...BUSINESS_CONNECTORS,
  ...CONTINUATION_PATTERNS,
  ...Object.values(ROOT_CAUSE_KEYWORDS).flat(),
  "pas de methode",
  "pas de méthode",
  "pas de cadre",
  "pas de processus",
  "rien n est formalise",
  "rien n'est formalisé",
  "rien n est clair",
  "rien n'est clair",
  "pas clair dans les roles",
  "pas clair dans les rôles",
  "responsabilites pas claires",
  "responsabilités pas claires",
  "manque de methode",
  "manque de méthode",
  "manque de cadre",
  "manque de pilotage",
  "par habitude",
  "au cas par cas",
]);

function uniqueStaticStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const key = String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();

    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }

  return out;
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeForMatch(value: string | null | undefined): string {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function splitSentences(text: string): string[] {
  return normalizeText(text)
    .split(/(?<=[\.\!\?\;])\s+|\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const key = normalizeForMatch(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }

  return out;
}

function hasAnyPattern(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => text.includes(normalizeForMatch(pattern)));
}

function collectMatchingPatterns(text: string, patterns: string[]): string[] {
  return uniqueStrings(
    patterns.filter((pattern) => text.includes(normalizeForMatch(pattern)))
  );
}

function hasBusinessCue(text: string): boolean {
  return BUSINESS_FRAGMENT_HINTS.some((pattern) =>
    text.includes(normalizeForMatch(pattern))
  );
}

function hasContinuationCue(text: string): boolean {
  return CONTINUATION_PATTERNS.some((pattern) =>
    text.includes(normalizeForMatch(pattern))
  );
}

function extractFacts(
  cleanedMessage: string,
  currentQuestion?: AnalyzerQuestionContext | null
): string[] {
  const sentences = splitSentences(cleanedMessage);
  const hasContext = Boolean(normalizeText(currentQuestion?.theme));

  const candidates = sentences.filter((sentence) => {
    const normalized = normalizeForMatch(sentence);

    if (!normalized) return false;
    if (hasAnyPattern(normalized, CLARIFICATION_PATTERNS)) return false;

    const shortButUseful =
      sentence.length >= 8 &&
      hasContext &&
      (hasBusinessCue(normalized) || hasContinuationCue(normalized));

    if (sentence.length < 18 && !shortButUseful) {
      return false;
    }

    if (
      normalized === "oui" ||
      normalized === "non" ||
      normalized === "ok" ||
      normalized === "d accord" ||
      normalized === "d'accord"
    ) {
      return false;
    }

    return true;
  });

  const unique = uniqueStrings(candidates).slice(0, 4);

  if (
    unique.length === 0 &&
    hasContext &&
    cleanedMessage.length >= 8 &&
    hasBusinessCue(normalizeForMatch(cleanedMessage))
  ) {
    return [cleanedMessage];
  }

  return unique;
}

function detectRootCauses(cleanedMessage: string): RootCauseCategory[] {
  const normalized = normalizeForMatch(cleanedMessage);
  const results: RootCauseCategory[] = [];

  for (const [category, keywords] of Object.entries(ROOT_CAUSE_KEYWORDS) as Array<
    [RootCauseCategory, string[]]
  >) {
    const matched = keywords.some((keyword) =>
      normalized.includes(normalizeForMatch(keyword))
    );

    if (matched) {
      results.push(category);
    }
  }

  return results;
}

function inferSuggestedAngle(
  rootCauses: RootCauseCategory[],
  cleanedMessage: string
): SuggestedAngle | null {
  const normalized = normalizeForMatch(cleanedMessage);

  if (
    rootCauses.includes("skills") ||
    rootCauses.includes("experience") ||
    rootCauses.includes("decision")
  ) {
    return "causality";
  }

  if (rootCauses.includes("arbitration")) {
    return "arbitration";
  }

  if (
    rootCauses.includes("pricing") ||
    rootCauses.includes("cash") ||
    normalized.includes("impact economique") ||
    normalized.includes("impact économique")
  ) {
    return "economics";
  }

  if (
    rootCauses.includes("organization") ||
    normalized.includes("methode") ||
    normalized.includes("méthode") ||
    normalized.includes("cadre") ||
    normalized.includes("processus") ||
    normalized.includes("formalis")
  ) {
    return "formalization";
  }

  if (rootCauses.includes("resources")) {
    return "dependency";
  }

  if (
    rootCauses.includes("execution") ||
    rootCauses.includes("quality") ||
    rootCauses.includes("commercial")
  ) {
    return "mechanism";
  }

  return null;
}

function computeBusinessMatterScore(params: {
  cleanedMessage: string;
  facts: string[];
  rootCauses: RootCauseCategory[];
  currentQuestion?: AnalyzerQuestionContext | null;
}): number {
  const { cleanedMessage, facts, rootCauses, currentQuestion } = params;
  const normalized = normalizeForMatch(cleanedMessage);
  const hasContext = Boolean(normalizeText(currentQuestion?.theme));
  const continuation = hasContinuationCue(normalized);
  const businessCue = hasBusinessCue(normalized);

  let score = 0;

  if (cleanedMessage.length >= 20) score += 10;
  if (cleanedMessage.length >= 30) score += 12;
  if (cleanedMessage.length >= 80) score += 12;

  if (facts.length >= 1) score += 18;
  if (facts.length >= 2) score += 8;

  if (rootCauses.length >= 1) score += 16;
  if (rootCauses.length >= 2) score += 8;

  if (businessCue) score += 12;

  if (BUSINESS_CONNECTORS.some((item) => normalized.includes(normalizeForMatch(item)))) {
    score += 10;
  }

  if (normalized.includes("parce que") || normalized.includes("du fait de")) {
    score += 8;
  }

  if (hasContext && continuation) {
    score += 14;
  }

  if (hasContext && businessCue && cleanedMessage.length <= 80) {
    score += 12;
  }

  if (hasContext && cleanedMessage.length <= 40 && facts.length > 0) {
    score += 8;
  }

  return score;
}

function buildSummary(
  intent: AnswerIntent,
  theme: string | null,
  facts: string[],
  rootCauses: RootCauseCategory[]
): string {
  const themeLabel = theme ? `"${theme}"` : "ce sujet";

  if (intent === "clarification_request") {
    return `L’utilisateur ne comprend pas correctement la question sur ${themeLabel}.`;
  }

  if (intent === "reframing") {
    if (rootCauses.length > 0) {
      return `L’utilisateur recadre le sujet sur ${themeLabel} en mettant en avant ${rootCauses.join(", ")}.`;
    }

    return `L’utilisateur recadre l’angle d’analyse sur ${themeLabel}.`;
  }

  if (intent === "challenge") {
    return `L’utilisateur conteste le cadrage actuel sur ${themeLabel}.`;
  }

  if (intent === "business_answer") {
    if (facts.length > 0) {
      return `L’utilisateur apporte de la matière métier exploitable sur ${themeLabel}.`;
    }

    return `L’utilisateur répond sur le fond concernant ${themeLabel}.`;
  }

  if (intent === "mixed") {
    return `L’utilisateur mélange recadrage et matière métier sur ${themeLabel}.`;
  }

  return "Le message apporte peu de matière directement exploitable.";
}

function buildFollowUp(params: {
  intent: AnswerIntent;
  theme: string | null;
  suggestedAngle: SuggestedAngle | null;
  rootCauses: RootCauseCategory[];
}): string | null {
  const { intent, theme, suggestedAngle, rootCauses } = params;
  const themeLabel = theme ? `"${theme}"` : "ce sujet";

  if (intent === "clarification_request") {
    return `Je reformule sur ${themeLabel} de façon plus concrète, en demandant qui pilote réellement le sujet, comment les décisions sont prises et quels faits observables montrent où se situe la difficulté.`;
  }

  if (intent === "reframing" || intent === "mixed") {
    if (suggestedAngle === "causality") {
      return `Je repars sur un angle causes racines pour ${themeLabel}, en vérifiant s’il s’agit surtout de compétences, d’expérience, de décisions ou d’organisation.`;
    }

    if (suggestedAngle === "arbitration") {
      return `Je repars sur la chaîne d’arbitrage pour ${themeLabel}, en clarifiant qui décide, qui valide et où se créent les blocages.`;
    }

    if (suggestedAngle === "economics") {
      return `Je repars sur l’impact économique de ${themeLabel}, en reliant les faits cités à la marge, au coût réel ou au cash.`;
    }

    if (suggestedAngle === "formalization") {
      return `Je repars sur le cadre réel de ${themeLabel}, en vérifiant ce qui est formalisé, ce qui relève de l’habitude et où les responsabilités restent floues.`;
    }

    if (rootCauses.length > 0) {
      return `Je pivote l’angle sur ${themeLabel} à partir des causes évoquées par l’utilisateur : ${rootCauses.join(", ")}.`;
    }

    return `Je recadre la prochaine question sur ${themeLabel} à partir de la correction apportée par l’utilisateur.`;
  }

  if (intent === "challenge") {
    return `Je reste sur ${themeLabel}, mais je vérifie le postulat au lieu de le présupposer.`;
  }

  if (intent === "noise") {
    return `Je demande un exemple concret observable sur ${themeLabel}.`;
  }

  return null;
}

export function analyzeUserAnswer(params: {
  rawMessage: string;
  currentQuestion?: AnalyzerQuestionContext | null;
}): AnswerAnalysis {
  const rawMessage = String(params.rawMessage ?? "");
  const cleanedMessage = normalizeText(rawMessage);
  const normalized = normalizeForMatch(cleanedMessage);

  const currentTheme = normalizeText(params.currentQuestion?.theme) || null;

  const clarificationMatches = collectMatchingPatterns(
    normalized,
    CLARIFICATION_PATTERNS
  );
  const challengeMatches = collectMatchingPatterns(normalized, CHALLENGE_PATTERNS);
  const reframingMatches = collectMatchingPatterns(normalized, REFRAMING_PATTERNS);

  const facts = extractFacts(cleanedMessage, params.currentQuestion);
  const rootCauses = detectRootCauses(cleanedMessage);
  const suggestedAngle = inferSuggestedAngle(rootCauses, cleanedMessage);

  const businessMatterScore = computeBusinessMatterScore({
    cleanedMessage,
    facts,
    rootCauses,
    currentQuestion: params.currentQuestion,
  });

  const asksClarification = clarificationMatches.length > 0;
  const challenges = challengeMatches.length > 0;
  const reframes = reframingMatches.length > 0;
  const hasBusinessMatter = businessMatterScore >= 28;

  let intent: AnswerIntent = "noise";
  let action: AnalyzerAction = "ask_for_examples";
  let confidence = 55;
  let shouldStoreAsAnswer = false;
  let shouldRephraseQuestion = false;
  let shouldPivotAngle = false;
  let rationale = "Message trop faible ou insuffisamment exploitable.";

  if (asksClarification && !hasBusinessMatter) {
    intent = "clarification_request";
    action = "rephrase_question";
    confidence = 92;
    shouldRephraseQuestion = true;
    rationale =
      "Le message exprime une incompréhension sans apporter de matière métier suffisante.";
  } else if ((reframes || challenges) && hasBusinessMatter) {
    intent = "mixed";
    action = "store_and_pivot";
    confidence = 88;
    shouldStoreAsAnswer = true;
    shouldPivotAngle = true;
    rationale =
      "Le message conteste ou recadre le sujet tout en apportant de la matière métier exploitable.";
  } else if (reframes) {
    intent = "reframing";
    action = hasBusinessMatter ? "store_and_pivot" : "challenge_same_topic";
    confidence = hasBusinessMatter ? 86 : 80;
    shouldStoreAsAnswer = hasBusinessMatter;
    shouldPivotAngle = true;
    rationale =
      "Le message corrige l’angle d’analyse et signale que la bonne piste n’est pas celle de la question initiale.";
  } else if (challenges) {
    intent = "challenge";
    action = hasBusinessMatter ? "store_and_pivot" : "challenge_same_topic";
    confidence = hasBusinessMatter ? 82 : 76;
    shouldStoreAsAnswer = hasBusinessMatter;
    shouldPivotAngle = hasBusinessMatter;
    rationale =
      "Le message conteste le postulat de départ ; il faut vérifier l’hypothèse au lieu de la conserver telle quelle.";
  } else if (hasBusinessMatter) {
    intent = "business_answer";
    action = "store_answer";
    confidence = Math.min(94, 68 + businessMatterScore / 3);
    shouldStoreAsAnswer = true;
    rationale =
      "Le message contient une réponse exploitable, y compris lorsqu’elle est courte mais clairement contextualisée par la question en cours.";
  } else if (asksClarification) {
    intent = "clarification_request";
    action = "rephrase_question";
    confidence = 78;
    shouldRephraseQuestion = true;
    rationale = "Le besoin de reformulation domine le message.";
  } else {
    intent = "noise";
    action = "ask_for_examples";
    confidence = 62;
    rationale =
      "Le message reste trop court, trop vague ou trop elliptique pour faire progresser le diagnostic.";
  }

  return {
    rawMessage,
    cleanedMessage,
    intent,
    action,
    confidence: Math.round(confidence),

    isUsableBusinessMatter: hasBusinessMatter,
    shouldStoreAsAnswer,
    shouldRephraseQuestion,
    shouldPivotAngle,

    summary: buildSummary(intent, currentTheme, facts, rootCauses),
    rationale,

    extractedFacts: facts,
    reframingSignals: reframingMatches,
    contradictionSignals: challengeMatches,
    detectedRootCauses: rootCauses,
    suggestedAngle,
    suggestedFollowUp: buildFollowUp({
      intent,
      theme: currentTheme,
      suggestedAngle,
      rootCauses,
    }),
  };
}

export function isClarificationRequest(analysis: AnswerAnalysis): boolean {
  return analysis.intent === "clarification_request";
}

export function isReframingAnswer(analysis: AnswerAnalysis): boolean {
  return analysis.intent === "reframing" || analysis.intent === "mixed";
}

export function isBusinessAnswer(analysis: AnswerAnalysis): boolean {
  return analysis.intent === "business_answer" || analysis.intent === "mixed";
}

export function buildRephrasedQuestionFromAnalysis(params: {
  analysis: AnswerAnalysis;
  currentQuestion?: AnalyzerQuestionContext | null;
}): string {
  const theme = normalizeText(params.currentQuestion?.theme) || "ce sujet";
  const constat = normalizeText(params.currentQuestion?.constat);
  const analysisText = params.analysis;

  if (analysisText.intent === "clarification_request") {
    return `Je reformule simplement sur "${theme}" : qui s’en occupe réellement aujourd’hui, comment les décisions sont prises, et quel problème concret vous observez sur le terrain ?`;
  }

  if (
    analysisText.shouldPivotAngle &&
    analysisText.suggestedAngle === "causality"
  ) {
    return `Restons sur "${theme}", mais en repartant du bon angle : selon vous, la difficulté vient-elle surtout d’un manque de compétences, d’expérience, de décisions inadaptées ou d’une organisation mal posée ?`;
  }

  if (
    analysisText.shouldPivotAngle &&
    analysisText.suggestedAngle === "arbitration"
  ) {
    return `Sur "${theme}", qui décide réellement, qui valide, et à quel endroit la chaîne d’arbitrage ralentit ou déforme les décisions ?`;
  }

  if (
    analysisText.shouldPivotAngle &&
    analysisText.suggestedAngle === "economics"
  ) {
    return `Sur "${theme}", quel est l’impact économique concret du problème évoqué : marge, coût réel, trésorerie ou rentabilité ?`;
  }

  if (
    analysisText.shouldPivotAngle &&
    analysisText.suggestedAngle === "formalization"
  ) {
    return `Sur "${theme}", qu’est-ce qui relève aujourd’hui d’un manque de méthode, d’un cadre insuffisamment formalisé ou de responsabilités encore floues ?`;
  }

  if (constat) {
    return `Je reformule sur "${theme}" à partir du constat suivant : ${constat} Dans le fonctionnement réel, qu’est-ce qui explique le mieux cette situation ?`;
  }

  return `Je reformule sur "${theme}" : quel est le problème concret, d’où vient-il, et comment se manifeste-t-il aujourd’hui dans l’entreprise ?`;
}