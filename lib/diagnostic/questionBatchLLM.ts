import type {
  CoverageState,
  FactBackedQuestion,
  SignalAngle,
} from "@/lib/diagnostic/types";
import {
  selectFactsForIteration,
  buildConstatFromFact,
  buildRiskFromFact,
  updateFactAskedCounter,
  updateCoverageAfterBatch,
} from "@/lib/diagnostic/diagnosticState";
import {
  expectedQuestionCount,
  toDimensionKey,
  type IterationMode,
} from "@/lib/diagnostic/diagnosticContracts";
import {
  generateQuestionBatch,
  type FactSummary,
} from "./questionGeneratorLLM";

const MAX_QUESTIONS_PER_THEME = 3;

function normalizeText(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isWeakRawSignal(value: string) {
  const text = String(value || "").trim();

  if (!text) return true;

  const digits = (text.match(/\d/g) || []).length;
  const letters = (text.match(/[a-zA-ZÀ-ÿ]/g) || []).length;

  if (digits >= 5 && letters < 20) return true;
  if (/^(\d+\s*){3,}/.test(text)) return true;
  if (text.length < 8) return true;

  const normalized = normalizeText(text);
  const banned = [
    "ressources vs charge",
    "clarte des roles",
    "recrutement et integration",
    "turnover absenteisme stabilite",
    "organisation rh",
    "pilotage commercial",
  ];

  return banned.includes(normalized);
}

function cleanSentence(value: string, maxLength = 360) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();

  if (text.length <= maxLength) return text;

  const cut = text.slice(0, maxLength);
  const lastStop = Math.max(
    cut.lastIndexOf("."),
    cut.lastIndexOf(";"),
    cut.lastIndexOf(",")
  );

  if (lastStop > 120) return cut.slice(0, lastStop).trim();
  return cut.trim();
}

function uniqueStrings(values: unknown[], max = 8): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const text = cleanSentence(String(value || ""), 360);
    if (!text) continue;

    const key = normalizeText(text);
    if (!key || seen.has(key)) continue;

    seen.add(key);
    out.push(text);

    if (out.length >= max) break;
  }

  return out;
}

function normalizeAngleValue(value: unknown): SignalAngle | undefined {
  const x = normalizeText(String(value || ""));

  if (x === "example" || x === "cas" || x === "illustration") return "example";
  if (x === "magnitude" || x === "quantification" || x === "ordre de grandeur") {
    return "magnitude";
  }
  if (x === "mechanism" || x === "mecanisme") return "mechanism";
  if (x === "causality" || x === "cause" || x === "causalite") return "causality";
  if (x === "dependency" || x === "dependance") return "dependency";
  if (x === "arbitration" || x === "arbitrage") return "arbitration";
  if (x === "formalization" || x === "formalisme") return "formalization";
  if (x === "transition") return "transition";
  if (x === "economics" || x === "economic" || x === "economique") return "economics";
  if (x === "frequency" || x === "frequence") return "frequency";
  if (x === "feedback" || x === "rex" || x === "retour d experience") return "feedback";

  return undefined;
}

function uniqueAngles(values: unknown[], max = 8): SignalAngle[] {
  const out: SignalAngle[] = [];

  for (const value of values) {
    const angle = normalizeAngleValue(value);
    if (!angle) continue;
    if (!out.includes(angle)) out.push(angle);
    if (out.length >= max) break;
  }

  return out;
}

function hasNumericValues(fact: any) {
  return Boolean(
    fact?.numeric_values &&
      typeof fact.numeric_values === "object" &&
      Object.keys(fact.numeric_values).length > 0
  );
}

function numericValuesToText(fact: any) {
  if (!hasNumericValues(fact)) return "";

  return Object.entries(fact.numeric_values as Record<string, unknown>)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" | ");
}

function getFactTagValue(fact: any, prefix: string): string | null {
  const tags = Array.isArray(fact?.tags) ? fact.tags : [];

  for (const tag of tags) {
    const text = String(tag || "").trim();
    if (!text.startsWith(prefix)) continue;
    return text.slice(prefix.length).trim() || null;
  }

  return null;
}

function getDiagnosticStatement(fact: any) {
  return cleanSentence(
    String(
      fact?.diagnostic_statement ||
        getFactTagValue(fact, "diagnostic_statement:") ||
        fact?.raw_signal ||
        getFactTagValue(fact, "raw_signal:") ||
        fact?.observed_element ||
        fact?.source_excerpt ||
        ""
    ),
    520
  );
}

function getSuggestedQuestions(fact: any) {
  return uniqueStrings(fact?.suggested_questions || [], 5).filter((q) => {
    const normalized = normalizeText(q);
    return (
      normalized.length >= 20 &&
      !normalized.includes("point le moins maitrise") &&
      !normalized.includes("pouvez vous preciser ce point")
    );
  });
}

function getFactMemory(fact: any) {
  return {
    previous_questions: uniqueStrings(fact?.previous_questions || [], 12),
    previous_answers: uniqueStrings(fact?.previous_answers || [], 12),
    answer_summaries: uniqueStrings(fact?.answer_summaries || [], 12),
    validated_findings: uniqueStrings(
      [...(fact?.validated_findings || []), ...(fact?.evidence_refs || [])],
      12
    ),
    open_hypotheses: uniqueStrings(fact?.open_hypotheses || [], 12),
    contradictions: uniqueStrings(fact?.contradiction_notes || [], 8),
    next_question_hints: uniqueStrings(fact?.next_question_hints || [], 10),
  };
}

function buildBetterRawSignal(fact: any, _dimension: number) {
  const statement = getDiagnosticStatement(fact);
  if (!isWeakRawSignal(statement)) return statement;

  const source = cleanSentence(String(fact?.source_excerpt || ""), 520);
  if (!isWeakRawSignal(source)) return source;

  const numericText = numericValuesToText(fact);
  if (numericText) return cleanSentence(numericText, 360);

  const fallback = buildConstatFromFact(fact);
  if (!isWeakRawSignal(fallback)) return cleanSentence(fallback, 520);

  const risk = fact?.managerial_risk || buildRiskFromFact(fact);
  if (!isWeakRawSignal(risk)) return cleanSentence(risk, 360);

  return cleanSentence(String(fact?.theme || "Signal à clarifier"));
}

function tokenSet(value: string): Set<string> {
  return new Set(
    normalizeText(value)
      .split(" ")
      .filter((token) => token.length >= 4)
  );
}

function questionSimilarity(a: string, b: string) {
  const setA = tokenSet(a);
  const setB = tokenSet(b);

  if (setA.size === 0 || setB.size === 0) return 0;

  let common = 0;
  for (const token of setA) {
    if (setB.has(token)) common += 1;
  }

  return common / Math.max(setA.size, setB.size);
}

function inferQuestionIntent(question: string): string {
  const q = normalizeText(question);

  if (
    q.includes("qui decide") ||
    q.includes("qui arbitre") ||
    q.includes("qui tranche") ||
    q.includes("validation") ||
    q.includes("valide")
  ) {
    return "arbitration";
  }

  if (
    q.includes("pourquoi") ||
    q.includes("explique") ||
    q.includes("cause") ||
    q.includes("origine") ||
    q.includes("vient de")
  ) {
    return "causality";
  }

  if (
    q.includes("comment") ||
    q.includes("fonctionne") ||
    q.includes("deroule") ||
    q.includes("processus") ||
    q.includes("pratique")
  ) {
    return "mechanism";
  }

  if (
    q.includes("combien") ||
    q.includes("montant") ||
    q.includes("volume") ||
    q.includes("part") ||
    q.includes("ordre de grandeur") ||
    /\d/.test(q)
  ) {
    return "magnitude";
  }

  if (
    q.includes("depend") ||
    q.includes("personne cle") ||
    q.includes("absence") ||
    q.includes("relais")
  ) {
    return "dependency";
  }

  if (
    q.includes("formalise") ||
    q.includes("procedure") ||
    q.includes("cadre") ||
    q.includes("regle") ||
    q.includes("documente")
  ) {
    return "formalization";
  }

  if (
    q.includes("impact") ||
    q.includes("marge") ||
    q.includes("cout") ||
    q.includes("rentabilite") ||
    q.includes("ebitda")
  ) {
    return "economics";
  }

  if (
    q.includes("frequence") ||
    q.includes("souvent") ||
    q.includes("chaque") ||
    q.includes("tous les")
  ) {
    return "frequency";
  }

  if (
    q.includes("changer") ||
    q.includes("corriger") ||
    q.includes("securiser") ||
    q.includes("verrouiller") ||
    q.includes("mettre en place")
  ) {
    return "transition";
  }

  return "general";
}

function isGenericQuestion(question: string) {
  const q = normalizeText(question);

  if (!q) return true;

  const forbidden = [
    "quel est aujourd hui le point le moins maitrise",
    "quel est le point le moins maitrise",
    "pouvez vous preciser ce point",
    "comment expliquez vous ce sujet",
    "que pouvez vous dire sur",
    "sur ce theme pouvez vous",
    "pouvez vous m en dire plus",
    "qu en pensez vous",
  ];

  return forbidden.some((f) => q.includes(f));
}

function rememberPlannedQuestion(
  coverage: CoverageState,
  q: FactBackedQuestion
) {
  const factRef: any = coverage.fact_inventory.find(
    (f) => String(f.id) === q.fact_id
  );

  if (!factRef) return;

  const angle = normalizeAngleValue(q.intended_angle);

  if (!Array.isArray(factRef.asked_angles)) factRef.asked_angles = [];
  if (!Array.isArray(factRef.missing_angles)) factRef.missing_angles = [];
  if (!Array.isArray(factRef.previous_questions)) {
    factRef.previous_questions = [];
  }
  if (!Array.isArray(factRef.question_intents)) {
    factRef.question_intents = [];
  }

  if (angle) {
    if (
      !factRef.asked_angles.some(
        (a: any) => normalizeText(String(a || "")) === angle
      )
    ) {
      factRef.asked_angles.push(angle);
    }

    factRef.missing_angles = factRef.missing_angles.filter(
      (a: any) => normalizeText(String(a || "")) !== angle
    );

    factRef.last_planned_angle = angle;
  }

  const questionText = String(q.question || "").trim();
  const intent = inferQuestionIntent(questionText);

  const existing = factRef.previous_questions.some(
    (x: string) => normalizeText(x) === normalizeText(questionText)
  );

  if (questionText && !existing) {
    factRef.previous_questions.push(questionText);
    factRef.previous_questions = factRef.previous_questions.slice(-14);
  }

  if (
    intent &&
    intent !== "general" &&
    !factRef.question_intents.includes(intent)
  ) {
    factRef.question_intents.push(intent);
    factRef.question_intents = factRef.question_intents.slice(-12);
  }

  factRef.progress = factRef.progress ?? "questioned";
}

function hasUsefulMemory(fact: any) {
  return (
    (Array.isArray(fact?.previous_answers) && fact.previous_answers.length > 0) ||
    (Array.isArray(fact?.answer_summaries) && fact.answer_summaries.length > 0) ||
    (Array.isArray(fact?.validated_findings) && fact.validated_findings.length > 0) ||
    (Array.isArray(fact?.evidence_refs) && fact.evidence_refs.length > 0) ||
    (Array.isArray(fact?.open_hypotheses) && fact.open_hypotheses.length > 0)
  );
}

function countAvailableAngles(fact: any) {
  const asked = new Set(uniqueAngles(fact?.asked_angles || []));
  const missing = uniqueAngles(fact?.missing_angles || []);

  return missing.filter((angle) => !asked.has(angle)).length;
}

function scoreCandidateFact(fact: any, iteration: number) {
  let score = 0;

  const criticality = Number(fact?.criticality_score ?? 0);
  score += criticality > 0 ? criticality * 4 : 12;

  score += Number(fact?.confidence_score || 0) / 5;

  if (hasNumericValues(fact)) score += 40;

  if (String(fact?.source_excerpt || "").trim().length >= 40) {
    score += 25;
  }

  if (getDiagnosticStatement(fact).length >= 80) {
    score += 20;
  }

  if (getSuggestedQuestions(fact).length > 0) {
    score += 18;
  }

  score += countAvailableAngles(fact) * 12;

  if (iteration >= 2 && hasUsefulMemory(fact)) score += 45;
  if (iteration >= 3 && hasUsefulMemory(fact)) score += 35;

  if (iteration >= 2 && !hasUsefulMemory(fact)) score -= 12;
  if (iteration >= 3 && !hasUsefulMemory(fact)) score -= 18;

  score -= Number(fact?.asked_count || 0) * 8;
  score -= uniqueAngles(fact?.asked_angles || []).length * 4;

  return score;
}

function shouldKeepFact(fact: any, iteration: number) {
  const statement = getDiagnosticStatement(fact);
  const source = String(fact?.source_excerpt || "").trim();

  if (!statement || statement.length < 20) return false;

  if (isWeakRawSignal(statement) && !hasNumericValues(fact) && source.length < 40) {
    return false;
  }

  if (source.length >= 60 || hasNumericValues(fact)) {
    return true;
  }

  if (iteration >= 2 && hasUsefulMemory(fact)) return true;

  if (Array.isArray(fact?.missing_angles) && fact.missing_angles.length > 0) {
    return true;
  }

  return getSuggestedQuestions(fact).length > 0;
}

function buildFactSummary(params: {
  fact: any;
  dimension: number;
}): FactSummary {
  const { fact, dimension } = params;

  const memory = getFactMemory(fact);
  const suggestedQuestions = getSuggestedQuestions(fact);
  const numericContext = numericValuesToText(fact);
  const diagnosticStatement = getDiagnosticStatement(fact);

  return {
    id: String(fact.id),
    theme: String(fact.theme || ""),
    raw_signal: buildBetterRawSignal(fact, dimension),
    diagnostic_statement: diagnosticStatement || undefined,
    source_excerpt: cleanSentence(String(fact.source_excerpt || ""), 520) || undefined,
    numeric_values: hasNumericValues(fact) ? fact.numeric_values : undefined,
    suggested_questions: suggestedQuestions,
    managerial_risk: cleanSentence(
      fact.managerial_risk || buildRiskFromFact(fact),
      360
    ),
    recommended_entry_angle: String(
      fact.recommended_entry_angle ||
        fact.last_planned_angle ||
        fact.missing_angles?.[0] ||
        "mechanism"
    ),
    progress: fact.progress ? String(fact.progress) : undefined,
    missing_angles: uniqueAngles(fact.missing_angles || []),
    asked_angles: uniqueAngles(fact.asked_angles || []),
    numeric_context: numericContext || undefined,
    ...memory,
  };
}

function ensureQuestionIsAnchored(question: string, fact: any) {
  const q = normalizeText(question);
  const statement = normalizeText(getDiagnosticStatement(fact));
  const source = normalizeText(String(fact?.source_excerpt || ""));
  const numeric = normalizeText(numericValuesToText(fact));
  const memory = normalizeText(
    [
      ...(fact?.previous_answers || []),
      ...(fact?.answer_summaries || []),
      ...(fact?.validated_findings || []),
      ...(fact?.evidence_refs || []),
    ].join(" ")
  );

  if (!q) return false;
  if (q.length < 25) return false;

  if (
    numeric &&
    numeric.split(" ").some((token) => token.length >= 2 && q.includes(token))
  ) {
    return true;
  }

  const usefulTokens = [...statement.split(" "), ...source.split(" "), ...memory.split(" ")]
    .filter((token) => token.length >= 4)
    .slice(0, 45);

  let hits = 0;
  for (const token of usefulTokens) {
    if (q.includes(token)) hits += 1;
  }

  return hits >= 1;
}

function chooseNextAngle(fact: any, iteration: number): SignalAngle {
  const asked = new Set(uniqueAngles(fact?.asked_angles || []));
  const missing = uniqueAngles(fact?.missing_angles || []).filter(
    (angle) => !asked.has(angle)
  );

  if (missing.length > 0) return missing[0];

  const candidates: SignalAngle[] =
    iteration <= 1
      ? hasNumericValues(fact)
        ? ["magnitude", "mechanism", "arbitration", "formalization"]
        : ["mechanism", "formalization", "arbitration", "dependency"]
      : iteration === 2
      ? ["causality", "arbitration", "dependency", "economics", "formalization"]
      : ["transition", "economics", "arbitration", "feedback", "formalization"];

  return candidates.find((angle) => !asked.has(angle)) || candidates[0];
}

function fallbackQuestionFromFact(fact: any, iteration: number): string {
  const statement =
    getDiagnosticStatement(fact) ||
    String(fact?.observed_element || "") ||
    String(fact?.theme || "ce point");

  const numeric = numericValuesToText(fact);

  const previous =
    uniqueStrings(fact?.answer_summaries || [], 1)[0] ||
    uniqueStrings(fact?.previous_answers || [], 1)[0] ||
    uniqueStrings(fact?.validated_findings || [], 1)[0] ||
    uniqueStrings(fact?.evidence_refs || [], 1)[0];

  if (iteration === 1 && numeric) {
    return `Sur le point suivant (${numeric}), qu’est-ce qui vous paraît le plus important à comprendre pour établir le bon diagnostic : ${statement} ?`;
  }

  if (iteration === 1) {
    return `Sur ce point précis, qu’est-ce qui vous paraît le plus important à comprendre pour établir le bon diagnostic : ${statement} ?`;
  }

  if (iteration === 2 && previous) {
    return `Vous avez indiqué "${previous}". Quel point faut-il encore clarifier pour confirmer ou nuancer le diagnostic sur ce sujet ?`;
  }

  if (iteration === 2) {
    return `Quel point faut-il encore clarifier pour confirmer ou nuancer le diagnostic sur ce sujet : ${statement} ?`;
  }

  if (previous) {
    return `À partir de votre réponse "${previous}", quelle condition permettrait de sécuriser durablement ce point ?`;
  }

  return `Quelle condition permettrait de sécuriser durablement ce point : ${statement} ?`;
}

function buildFallbackQuestionForFact(params: {
  fact: any;
  dimension: number;
  iteration: number;
}): FactBackedQuestion {
  const { fact, dimension, iteration } = params;
  const intendedAngle = chooseNextAngle(fact, iteration);

  return {
    fact_id: String(fact.id),
    theme: String(fact.theme || ""),
    question: cleanSentence(fallbackQuestionFromFact(fact, iteration), 360),
    intended_angle: intendedAngle,
    constat: buildBetterRawSignal(fact, dimension),
    risque_managerial: cleanSentence(
      fact.managerial_risk || buildRiskFromFact(fact),
      360
    ),
  } as FactBackedQuestion;
}

function getPreviouslyAskedQuestions(coverage: CoverageState, dimension: number) {
  const dimKey = toDimensionKey(dimension);
  const bucket = coverage.dimensions[dimKey];

  return uniqueStrings(
    [
      ...(Array.isArray(bucket?.asked) ? bucket.asked : []),
      ...coverage.fact_inventory.flatMap((f: any) =>
        Array.isArray(f.previous_questions) ? f.previous_questions : []
      ),
    ],
    250
  );
}

function isTooSimilarToAsked(question: string, previousQuestions: string[]) {
  const normalized = normalizeText(question);
  const intent = inferQuestionIntent(question);

  return previousQuestions.some((old) => {
    const oldNormalized = normalizeText(old);
    const oldIntent = inferQuestionIntent(old);
    const sim = questionSimilarity(old, question);

    if (oldNormalized === normalized) return true;
    if (sim >= 0.82) return true;

    if (intent !== "general" && oldIntent === intent && sim >= 0.66) {
      return true;
    }

    return false;
  });
}

function isAngleAlreadyConsumedForUsefulFact(
  fact: any,
  q: FactBackedQuestion,
  iteration: number
) {
  if (iteration <= 1) return false;
  if (!hasUsefulMemory(fact)) return false;

  const angle = normalizeAngleValue(q.intended_angle);
  if (!angle) return false;

  return uniqueAngles(fact?.asked_angles || []).includes(angle);
}

function materializeGeneratedQuestion(params: {
  generatedQuestion: {
    fact_id: string;
    theme?: string;
    question: string;
    intended_angle?: string;
  };
  selectedFacts: any[];
  dimension: number;
  iteration: number;
}): FactBackedQuestion {
  const { generatedQuestion, selectedFacts, dimension, iteration } = params;

  const fact: any =
    selectedFacts.find((f) => String(f.id) === generatedQuestion.fact_id) || {
      id: generatedQuestion.fact_id,
      theme: generatedQuestion.theme,
    };

  const fallbackQuestion = fallbackQuestionFromFact(fact, iteration);
  const candidateQuestion = cleanSentence(generatedQuestion.question, 360);
  const anchored =
    !isGenericQuestion(candidateQuestion) &&
    ensureQuestionIsAnchored(candidateQuestion, fact);

  return {
    fact_id: generatedQuestion.fact_id,
    theme: generatedQuestion.theme || String(fact.theme || ""),
    question: anchored ? candidateQuestion : fallbackQuestion,
    intended_angle:
      normalizeAngleValue(generatedQuestion.intended_angle) ||
      chooseNextAngle(fact, iteration),
    constat: buildBetterRawSignal(fact, dimension),
    risque_managerial: cleanSentence(
      fact.managerial_risk || buildRiskFromFact(fact),
      360
    ),
  } as FactBackedQuestion;
}

function selectDiverseFacts(params: {
  facts: any[];
  expectedCount: number;
  iteration: number;
}) {
  const { facts, expectedCount, iteration } = params;
  const selected: any[] = [];
  const perTheme = new Map<string, number>();

  const preferred =
    iteration >= 2
      ? [
          ...facts.filter(hasUsefulMemory),
          ...facts.filter((fact) => !hasUsefulMemory(fact)),
        ]
      : facts;

  for (const fact of preferred) {
    const themeKey = normalizeText(String(fact?.theme || ""));
    const count = perTheme.get(themeKey) ?? 0;

    if (themeKey && count >= MAX_QUESTIONS_PER_THEME) continue;

    selected.push(fact);
    perTheme.set(themeKey, count + 1);

    if (selected.length >= Math.max(expectedCount * 3, expectedCount + 4)) {
      break;
    }
  }

  if (selected.length < expectedCount) {
    for (const fact of facts) {
      if (selected.some((x) => String(x.id) === String(fact.id))) continue;
      selected.push(fact);
      if (selected.length >= Math.max(expectedCount * 3, expectedCount + 4)) {
        break;
      }
    }
  }

  return selected;
}

function pushQuestionIfValid(params: {
  q: FactBackedQuestion;
  finalBatch: FactBackedQuestion[];
  selectedFacts: any[];
  coverage: CoverageState;
  dimension: number;
  iteration: number;
  expectedCount: number;
  previouslyAsked: string[];
  seenQuestions: Set<string>;
  seenThemeIntent: Set<string>;
  themeCounts: Map<string, number>;
}) {
  const {
    q,
    finalBatch,
    selectedFacts,
    coverage,
    iteration,
    expectedCount,
    previouslyAsked,
    seenQuestions,
    seenThemeIntent,
    themeCounts,
  } = params;

  if (finalBatch.length >= expectedCount) return false;

  const normalized = normalizeText(q.question);
  if (!normalized) return false;
  if (normalized.length < 25) return false;
  if (isGenericQuestion(q.question)) return false;
  if (seenQuestions.has(normalized)) return false;

  const factRef: any =
    coverage.fact_inventory.find((f) => String(f.id) === q.fact_id) ||
    selectedFacts.find((f) => String(f.id) === q.fact_id);

  if (!factRef) return false;

  if (
    isAngleAlreadyConsumedForUsefulFact(factRef, q, iteration) &&
    isTooSimilarToAsked(q.question, previouslyAsked)
  ) {
    return false;
  }

  const anchored = ensureQuestionIsAnchored(q.question, factRef);

  if (!anchored && inferQuestionIntent(q.question) === "general") {
    return false;
  }

  if (isTooSimilarToAsked(q.question, previouslyAsked)) {
    return false;
  }

  const themeKey = normalizeText(q.theme);
  const intent = inferQuestionIntent(q.question);
  const themeIntentKey = `${themeKey}::${intent}`;
  const themeCount = themeCounts.get(themeKey) ?? 0;

  if (themeKey && themeCount >= MAX_QUESTIONS_PER_THEME) return false;

  if (
    intent !== "general" &&
    seenThemeIntent.has(themeIntentKey) &&
    finalBatch.some(
      (existing) =>
        normalizeText(existing.theme) === themeKey &&
        existing.fact_id === q.fact_id
    )
  ) {
    return false;
  }

  seenQuestions.add(normalized);
  seenThemeIntent.add(themeIntentKey);
  themeCounts.set(themeKey, themeCount + 1);
  finalBatch.push(q);

  return true;
}

function addFallbackQuestions(params: {
  finalBatch: FactBackedQuestion[];
  selectedFacts: any[];
  expectedCount: number;
  dimension: number;
  iteration: number;
  coverage: CoverageState;
  previouslyAsked: string[];
  seenQuestions: Set<string>;
  seenThemeIntent: Set<string>;
  themeCounts: Map<string, number>;
  allowReusingFactIds: boolean;
}) {
  const {
    finalBatch,
    selectedFacts,
    expectedCount,
    dimension,
    iteration,
    coverage,
    previouslyAsked,
    seenQuestions,
    seenThemeIntent,
    themeCounts,
    allowReusingFactIds,
  } = params;

  const usedFactIds = new Set(finalBatch.map((q) => q.fact_id));

  for (const fact of selectedFacts) {
    if (finalBatch.length >= expectedCount) break;

    const factId = String(fact.id);
    if (!allowReusingFactIds && usedFactIds.has(factId)) continue;

    const fallback = buildFallbackQuestionForFact({
      fact,
      dimension,
      iteration,
    });

    const added = pushQuestionIfValid({
      q: fallback,
      finalBatch,
      selectedFacts,
      coverage,
      dimension,
      iteration,
      expectedCount,
      previouslyAsked,
      seenQuestions,
      seenThemeIntent,
      themeCounts,
    });

    if (added) usedFactIds.add(factId);
  }
}

export async function buildQuestionBatchLLM(params: {
  extractedText: string;
  coverage: CoverageState;
  dimension: number;
  iteration: number;
  history: string;
  mode: IterationMode | string;
}): Promise<FactBackedQuestion[]> {
  const { coverage, dimension, iteration, mode } = params;
  const typedMode = mode as IterationMode;

  const selection: any = selectFactsForIteration(
    coverage,
    dimension,
    iteration,
    typedMode
  );

  let facts: any[] = Array.isArray(selection)
    ? selection
    : Array.isArray(selection?.facts)
    ? selection.facts
    : Array.isArray(selection?.selectedFacts)
    ? selection.selectedFacts
    : [];

  if (!facts || facts.length === 0) return [];

  facts = facts
    .filter((fact: any) => shouldKeepFact(fact, iteration))
    .sort(
      (a: any, b: any) =>
        scoreCandidateFact(b, iteration) - scoreCandidateFact(a, iteration)
    );

  if (facts.length === 0) return [];

  const expectedCount = expectedQuestionCount(iteration, typedMode);

  const selectedFacts = selectDiverseFacts({
    facts,
    expectedCount,
    iteration,
  });

  const summaries: FactSummary[] = selectedFacts.map((fact: any) =>
    buildFactSummary({
      fact,
      dimension,
    })
  );

  const generated = await generateQuestionBatch({
    facts: summaries,
    dimension,
    iteration,
  });

  const batch: FactBackedQuestion[] = generated.map((q) =>
    materializeGeneratedQuestion({
      generatedQuestion: q,
      selectedFacts,
      dimension,
      iteration,
    })
  );

  const previouslyAsked = getPreviouslyAskedQuestions(coverage, dimension);
  const seenQuestions = new Set<string>();
  const seenThemeIntent = new Set<string>();
  const themeCounts = new Map<string, number>();
  const finalBatch: FactBackedQuestion[] = [];

  for (const q of batch) {
    pushQuestionIfValid({
      q,
      finalBatch,
      selectedFacts,
      coverage,
      dimension,
      iteration,
      expectedCount,
      previouslyAsked,
      seenQuestions,
      seenThemeIntent,
      themeCounts,
    });

    if (finalBatch.length >= expectedCount) break;
  }

  if (finalBatch.length < expectedCount) {
    addFallbackQuestions({
      finalBatch,
      selectedFacts,
      expectedCount,
      dimension,
      iteration,
      coverage,
      previouslyAsked,
      seenQuestions,
      seenThemeIntent,
      themeCounts,
      allowReusingFactIds: false,
    });
  }

  if (finalBatch.length < expectedCount) {
    addFallbackQuestions({
      finalBatch,
      selectedFacts,
      expectedCount,
      dimension,
      iteration,
      coverage,
      previouslyAsked,
      seenQuestions,
      seenThemeIntent,
      themeCounts,
      allowReusingFactIds: true,
    });
  }

  if (finalBatch.length === 0 && selectedFacts.length > 0) {
    for (const fact of selectedFacts.slice(0, expectedCount)) {
      finalBatch.push(
        buildFallbackQuestionForFact({
          fact,
          dimension,
          iteration,
        })
      );

      if (finalBatch.length >= expectedCount) break;
    }
  }

  console.log("[diagnostic][questionBatchLLM_result]", {
    dimension,
    iteration,
    expectedCount,
    selectedFacts: selectedFacts.length,
    generated: generated.length,
    finalBatch: finalBatch.length,
    sampleQuestions: finalBatch.slice(0, 3).map((q) => ({
      fact_id: q.fact_id,
      theme: q.theme,
      question: q.question,
      intended_angle: q.intended_angle,
    })),
  });

  for (const q of finalBatch) {
    rememberPlannedQuestion(coverage, q);
  }

  updateCoverageAfterBatch(coverage, dimension, iteration, finalBatch);
  updateFactAskedCounter(coverage, finalBatch);

  return finalBatch;
}