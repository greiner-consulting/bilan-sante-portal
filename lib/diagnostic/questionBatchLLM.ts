import type { CoverageState, FactBackedQuestion } from "@/lib/diagnostic/types";
import {
  selectFactsForIteration,
  buildConstatFromFact,
  buildRiskFromFact,
  updateFactAskedCounter,
  updateCoverageAfterBatch,
} from "@/lib/diagnostic/diagnosticState";
import { expectedQuestionCount, toDimensionKey } from "@/lib/diagnostic/diagnosticContracts";
import { generateQuestionBatch, type FactSummary } from "./questionGeneratorLLM";

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
  return false;
}

function cleanSentence(value: string, maxLength = 260) {
  const text = String(value || "").replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastStop = Math.max(cut.lastIndexOf("."), cut.lastIndexOf(";"), cut.lastIndexOf(","));
  if (lastStop > 80) return cut.slice(0, lastStop).trim();
  return cut.trim();
}

function uniqueStrings(values: unknown[], max = 8): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = cleanSentence(String(value || ""));
    if (!text) continue;
    const key = normalizeText(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

function getFactMemory(fact: any) {
  return {
    previous_questions: uniqueStrings(fact.previous_questions || [], 6),
    previous_answers: uniqueStrings(fact.previous_answers || [], 6),
    answer_summaries: uniqueStrings(fact.answer_summaries || [], 6),
    validated_findings: uniqueStrings([...(fact.validated_findings || []), ...(fact.evidence_refs || [])], 6),
    open_hypotheses: uniqueStrings(fact.open_hypotheses || [], 6),
    contradictions: uniqueStrings(fact.contradiction_notes || [], 6),
    next_question_hints: uniqueStrings(fact.next_question_hints || [], 6),
  };
}

function buildBetterRawSignal(fact: any, dimension: number) {
  const preferred = fact.raw_signal || fact.finding || fact.prudent_hypothesis || fact.source_excerpt || "";
  if (!isWeakRawSignal(preferred)) return cleanSentence(preferred);
  const fallback = buildConstatFromFact(fact);
  if (!isWeakRawSignal(fallback)) return cleanSentence(fallback);
  const risk = fact.managerial_risk || buildRiskFromFact(fact, dimension);
  if (!isWeakRawSignal(risk)) return cleanSentence(risk);
  return cleanSentence(String(fact.theme || "Signal à clarifier"));
}

function questionSimilarity(a: string, b: string) {
  const aa = normalizeText(a).split(" ").filter((x) => x.length > 2);
  const bb = normalizeText(b).split(" ").filter((x) => x.length > 2);
  if (aa.length === 0 || bb.length === 0) return 0;
  const setA = new Set(aa);
  const setB = new Set(bb);
  let common = 0;
  for (const token of setA) if (setB.has(token)) common += 1;
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
  ];
  return forbidden.some((f) => q.includes(f));
}

function rememberPlannedQuestion(coverage: CoverageState, q: FactBackedQuestion) {
  const factRef: any = coverage.fact_inventory.find((f) => String(f.id) === q.fact_id);
  if (!factRef) return;
  const angle = String(q.intended_angle || "").trim() as any;
  if (!Array.isArray(factRef.asked_angles)) factRef.asked_angles = [];
  if (!Array.isArray(factRef.missing_angles)) factRef.missing_angles = [];
  if (angle) {
    const lowerAngle = String(angle).toLowerCase();
    if (!factRef.asked_angles.some((a: any) => String(a || "").trim().toLowerCase() === lowerAngle)) {
      factRef.asked_angles.push(angle);
    }
    factRef.missing_angles = factRef.missing_angles.filter((a: any) => String(a || "").trim().toLowerCase() !== lowerAngle);
    factRef.last_planned_angle = angle;
  }
  if (!Array.isArray(factRef.previous_questions)) factRef.previous_questions = [];
  const existing = factRef.previous_questions.some((x: string) => normalizeText(x) === normalizeText(q.question));
  if (!existing) {
    factRef.previous_questions.push(q.question);
    factRef.previous_questions = factRef.previous_questions.slice(-10);
  }
  factRef.progress = factRef.progress ?? "questioned";
}

function hasUsefulMemory(fact: any) {
  return (Array.isArray(fact.previous_answers) && fact.previous_answers.length > 0) ||
    (Array.isArray(fact.answer_summaries) && fact.answer_summaries.length > 0) ||
    (Array.isArray(fact.validated_findings) && fact.validated_findings.length > 0) ||
    (Array.isArray(fact.evidence_refs) && fact.evidence_refs.length > 0);
}

function scoreCandidateFact(fact: any, iteration: number) {
  let score = 0;
  score += Number(fact.criticality_score || 0);
  score += Number(fact.confidence_score || 0) / 5;
  if (Array.isArray(fact.missing_angles)) score += fact.missing_angles.length * 8;
  if (iteration >= 2 && hasUsefulMemory(fact)) score += 25;
  if (iteration >= 3 && hasUsefulMemory(fact)) score += 20;
  score -= Number(fact.asked_count || 0) * 8;
  return score;
}

export async function buildQuestionBatchLLM(params: {
  extractedText: string;
  coverage: CoverageState;
  dimension: number;
  iteration: number;
  history: string;
  mode: string;
}): Promise<FactBackedQuestion[]> {
  const { coverage, dimension, iteration, mode } = params;
  const selection: any = selectFactsForIteration(coverage, dimension, iteration, mode);
  let facts: any[] = Array.isArray(selection) ? selection : Array.isArray(selection?.facts) ? selection.facts : Array.isArray(selection?.selectedFacts) ? selection.selectedFacts : [];
  if (!facts || facts.length === 0) return [];

  facts = facts
    .filter((f: any) => Array.isArray(f.missing_angles) ? f.missing_angles.length > 0 : true)
    .sort((a: any, b: any) => scoreCandidateFact(b, iteration) - scoreCandidateFact(a, iteration));

  if (facts.length === 0) return [];

  const summaries: FactSummary[] = facts.map((fact: any) => ({
    id: String(fact.id),
    theme: String(fact.theme || ""),
    raw_signal: buildBetterRawSignal(fact, dimension),
    managerial_risk: cleanSentence(fact.managerial_risk || buildRiskFromFact(fact, dimension)),
    recommended_entry_angle: String(fact.recommended_entry_angle || fact.last_planned_angle || fact.missing_angles?.[0] || "mechanism"),
    progress: fact.progress ? String(fact.progress) : undefined,
    missing_angles: Array.isArray(fact.missing_angles) ? fact.missing_angles.map((a: any) => String(a)) : undefined,
    asked_angles: Array.isArray(fact.asked_angles) ? fact.asked_angles.map((a: any) => String(a)) : undefined,
    ...getFactMemory(fact),
  }));

  const generated = await generateQuestionBatch({ facts: summaries, dimension, iteration });

  const batch: FactBackedQuestion[] = generated.map((q) => {
    const fact: any = facts.find((f) => String(f.id) === q.fact_id) || { id: q.fact_id, theme: q.theme };
    return {
      fact_id: q.fact_id,
      theme: q.theme || String(fact.theme || ""),
      question: cleanSentence(q.question, 280),
      intended_angle: q.intended_angle as any,
      constat: buildBetterRawSignal(fact, dimension),
      risque_managerial: cleanSentence(fact.managerial_risk || buildRiskFromFact(fact, dimension)),
    } as FactBackedQuestion;
  });

  const dimKey = toDimensionKey(dimension);
  const bucket = coverage.dimensions[dimKey];
  const previouslyAsked: string[] = [
    ...(Array.isArray(bucket?.asked) ? bucket.asked : []),
    ...coverage.fact_inventory.flatMap((f: any) => Array.isArray(f.previous_questions) ? f.previous_questions : []),
  ];

  const seen = new Set<string>();
  const deduped: FactBackedQuestion[] = [];
  for (const q of batch) {
    const normalized = normalizeText(q.question);
    if (!normalized) continue;
    if (isGenericQuestion(q.question)) continue;
    if (seen.has(normalized)) continue;
    const factRef: any = coverage.fact_inventory.find((f) => String(f.id) === q.fact_id);
    const lowerAngle = String(q.intended_angle || "").trim().toLowerCase();
    if (factRef && lowerAngle && Array.isArray(factRef.asked_angles) && factRef.asked_angles.some((a: any) => String(a || "").trim().toLowerCase() === lowerAngle)) continue;
    const tooSimilar = previouslyAsked.some((old) => normalizeText(old) === normalized || questionSimilarity(old, q.question) >= 0.72);
    if (tooSimilar) continue;
    seen.add(normalized);
    deduped.push(q);
  }

  const expectedCount = expectedQuestionCount(iteration, mode as any);
  const finalBatch = deduped.slice(0, expectedCount);
  for (const q of finalBatch) rememberPlannedQuestion(coverage, q);
  updateCoverageAfterBatch(coverage, dimension, iteration, finalBatch);
  updateFactAskedCounter(coverage, finalBatch);
  return finalBatch;
}
