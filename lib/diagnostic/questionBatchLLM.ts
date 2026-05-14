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
    previous_questions: uniqueStrings(fact?.previous_questions || [], 8),
    previous_answers: uniqueStrings(fact?.previous_answers || [], 8),
    answer_summaries: uniqueStrings(fact?.answer_summaries || [], 8),
    validated_findings: uniqueStrings(
      [...(fact?.validated_findings || []), ...(fact?.evidence_refs || [])],
      8
    ),
    open_hypotheses: uniqueStrings(fact?.open_hypotheses || [], 8),
    contradictions: uniqueStrings(fact?.contradiction_notes || [], 8),
    next_question_hints: uniqueStrings(fact?.next_question_hints || [], 8),
  };
}

function buildBetterRawSignal(fact: any, dimension: number) {
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

function questionSimilarity(a: string, b: string) {
  const aa = normalizeText(a)
    .split(" ")
    .filter((x) => x.length > 2);

  const bb = normalizeText(b)
    .split(" ")
    .filter((x) => x.length > 2);

  if (aa.length === 0 || bb.length === 0) return 0;

  const setA = new Set(aa);
  const setB = new Set(bb);

  let common = 0;
  for (const token of setA) {
    if (setB.has(token)) common += 1;
  }

  return common / Math.max(setA.size, setB.size);
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

  if (!Array.isArray(factRef.previous_questions)) {
    factRef.previous_questions = [];
  }

  const existing = factRef.previous_questions.some(
    (x: string) => normalizeText(x) === normalizeText(q.question)
  );

  if (!existing) {
    factRef.previous_questions.push(q.question);
    factRef.previous_questions = factRef.previous_questions.slice(-10);
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

function scoreCandidateFact(fact: any, iteration: number) {
  let score = 0;

  score += Number(fact?.criticality_score || 0);
  score += Number(fact?.confidence_score || 0) / 5;

  if (hasNumericValues(fact)) score += 40;

  if (String(fact?.source_excerpt || "").trim().length >= 40) {
    score += 25;
  }

  if (getDiagnosticStatement(fact).length >= 80) {
    score += 20;
  }

  if (getSuggestedQuestions(fact).length > 0) {
    score += 30;
  }

  if (Array.isArray(fact?.missing_angles)) {
    score += fact.missing_angles.length * 8;
  }

  if (iteration >= 2 && hasUsefulMemory(fact)) score += 35;
  if (iteration >= 3 && hasUsefulMemory(fact)) score += 25;

  score -= Number(fact?.asked_count || 0) * 8;

  return score;
}

function shouldKeepFact(fact: any, iteration: number) {
  const statement = getDiagnosticStatement(fact);
  const source = String(fact?.source_excerpt || "").trim();

  if (!statement || statement.length < 20) return false;

  if (isWeakRawSignal(statement) && !hasNumericValues(fact) && source.length < 40) {
    return false;
  }

  if (iteration >= 2 && hasUsefulMemory(fact)) return true;

  if (Array.isArray(fact?.missing_angles) && fact.missing_angles.length > 0) {
    return true;
  }

  return hasNumericValues(fact) || getSuggestedQuestions(fact).length > 0;
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

  if (!q) return false;
  if (q.length < 25) return false;

  if (
    numeric &&
    numeric.split(" ").some((token) => token.length >= 2 && q.includes(token))
  ) {
    return true;
  }

  const statementTokens = statement
    .split(" ")
    .filter((token) => token.length >= 4);

  const sourceTokens = source
    .split(" ")
    .filter((token) => token.length >= 4);

  const usefulTokens = [...statementTokens, ...sourceTokens].slice(0, 30);

  let hits = 0;
  for (const token of usefulTokens) {
    if (q.includes(token)) hits += 1;
  }

  return hits >= 2;
}

function fallbackQuestionFromFact(fact: any, iteration: number): string {
  const statement = getDiagnosticStatement(fact) || String(fact?.observed_element || "");
  const numeric = numericValuesToText(fact);

  if (iteration === 1 && numeric) {
    return `Sur le point suivant, quels éléments expliquent les chiffres constatés (${numeric}) : ${statement} ?`;
  }

  if (iteration === 1) {
    return `Concrètement, que se passe-t-il aujourd'hui sur ce point précis : ${statement} ?`;
  }

  if (iteration === 2) {
    return `À partir de vos réponses précédentes, qu'est-ce qui explique principalement ce point : ${statement} ?`;
  }

  return `Quel arbitrage ou changement concret permettrait de sécuriser durablement ce point : ${statement} ?`;
}

function buildFallbackQuestionForFact(params: {
  fact: any;
  dimension: number;
  iteration: number;
}): FactBackedQuestion {
  const { fact, dimension, iteration } = params;

  const intendedAngle =
    normalizeAngleValue(fact?.missing_angles?.[0]) ||
    normalizeAngleValue(fact?.last_planned_angle) ||
    normalizeAngleValue(fact?.recommended_entry_angle) ||
    "mechanism";

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

function addFallbackQuestions(params: {
  finalBatch: FactBackedQuestion[];
  selectedFacts: any[];
  expectedCount: number;
  dimension: number;
  iteration: number;
  allowReusingFactIds: boolean;
}) {
  const {
    finalBatch,
    selectedFacts,
    expectedCount,
    dimension,
    iteration,
    allowReusingFactIds,
  } = params;

  const usedFactIds = new Set(finalBatch.map((q) => q.fact_id));
  const usedQuestions = new Set(finalBatch.map((q) => normalizeText(q.question)));

  for (const fact of selectedFacts) {
    if (finalBatch.length >= expectedCount) break;

    const factId = String(fact.id);
    if (!allowReusingFactIds && usedFactIds.has(factId)) continue;

    const fallback = buildFallbackQuestionForFact({
      fact,
      dimension,
      iteration,
    });

    const normalizedQuestion = normalizeText(fallback.question);
    if (!normalizedQuestion || usedQuestions.has(normalizedQuestion)) continue;
    if (isGenericQuestion(fallback.question)) continue;

    finalBatch.push(fallback);
    usedFactIds.add(factId);
    usedQuestions.add(normalizedQuestion);
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
  const selectedFacts = facts.slice(0, Math.max(expectedCount * 2, expectedCount));

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

  const batch: FactBackedQuestion[] = generated.map((q) => {
    const fact: any =
      selectedFacts.find((f) => String(f.id) === q.fact_id) || {
        id: q.fact_id,
        theme: q.theme,
      };

    const fallbackQuestion = fallbackQuestionFromFact(fact, iteration);
    const candidateQuestion = cleanSentence(q.question, 320);
    const anchored =
      !isGenericQuestion(candidateQuestion) &&
      ensureQuestionIsAnchored(candidateQuestion, fact);

    return {
      fact_id: q.fact_id,
      theme: q.theme || String(fact.theme || ""),
      question: anchored ? candidateQuestion : fallbackQuestion,
      intended_angle: normalizeAngleValue(q.intended_angle) || "mechanism",
      constat: buildBetterRawSignal(fact, dimension),
      risque_managerial: cleanSentence(
        fact.managerial_risk || buildRiskFromFact(fact),
        360
      ),
    } as FactBackedQuestion;
  });

  const dimKey = toDimensionKey(dimension);
  const bucket = coverage.dimensions[dimKey];

  const previouslyAsked: string[] = [
    ...(Array.isArray(bucket?.asked) ? bucket.asked : []),
    ...coverage.fact_inventory.flatMap((f: any) =>
      Array.isArray(f.previous_questions) ? f.previous_questions : []
    ),
  ];

  const seen = new Set<string>();
  const deduped: FactBackedQuestion[] = [];

  for (const q of batch) {
    const normalized = normalizeText(q.question);
    if (!normalized) continue;
    if (isGenericQuestion(q.question)) continue;
    if (seen.has(normalized)) continue;

    const factRef: any = coverage.fact_inventory.find(
      (f) => String(f.id) === q.fact_id
    );

    const lowerAngle = normalizeText(String(q.intended_angle || ""));

    if (
      factRef &&
      lowerAngle &&
      Array.isArray(factRef.asked_angles) &&
      factRef.asked_angles.some(
        (a: any) => normalizeText(String(a || "")) === lowerAngle
      )
    ) {
      continue;
    }

    const tooSimilar = previouslyAsked.some(
      (old) =>
        normalizeText(old) === normalized ||
        questionSimilarity(old, q.question) >= 0.72
    );

    if (tooSimilar) continue;

    seen.add(normalized);
    deduped.push(q);
  }

  const finalBatch: FactBackedQuestion[] = deduped.slice(0, expectedCount);

  if (finalBatch.length < expectedCount) {
    addFallbackQuestions({
      finalBatch,
      selectedFacts,
      expectedCount,
      dimension,
      iteration,
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
      allowReusingFactIds: true,
    });
  }

  for (const q of finalBatch) {
    rememberPlannedQuestion(coverage, q);
  }

  updateCoverageAfterBatch(coverage, dimension, iteration, finalBatch);
  updateFactAskedCounter(coverage, finalBatch);

  return finalBatch;
}