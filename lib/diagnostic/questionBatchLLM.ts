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

/*
 * questionBatchLLM.ts
 *
 * This module provides an alternative implementation of the question batch
 * builder that relies on a large language model to craft questions.  It
 * mirrors the API of the original buildQuestionBatch function from
 * diagnosticQuestionPlanner.ts so that the diagnostic engine can switch to
 * LLM‑generated questions without any changes in its control flow.  The
 * function selects the next facts to be explored via selectFactsForIteration,
 * summarises those facts for the LLM, calls generateQuestionBatch to
 * obtain up to two questions per fact, and then maps the result back to
 * the FactBackedQuestion shape expected by the rest of the system.  It
 * finally updates the coverage to reflect that the facts have been asked.
 */

/**
 * Builds a batch of questions for a given dimension and iteration using
 * a language model.  It retrieves the next facts to discuss, constructs
 * summaries for the LLM, delegates question generation to generateQuestionBatch
 * and returns an array of fact‑backed questions.  The coverage object is
 * updated in place via updateFactAskedCounter.
 *
 * @param params.extractedText Entire extracted trame (unused but kept for signature parity)
 * @param params.coverage Current coverage state
 * @param params.dimension Current diagnostic dimension (1–4)
 * @param params.iteration Current iteration number within the dimension
 * @param params.history Conversation history (unused for now)
 * @param params.mode Selection mode (e.g. "normal", "reopen_after_no")
 */
export async function buildQuestionBatchLLM(params: {
  extractedText: string;
  coverage: CoverageState;
  dimension: number;
  iteration: number;
  history: string;
  mode: string;
}): Promise<FactBackedQuestion[]> {
  const { coverage, dimension, iteration, mode } = params;
  // Select the next facts to question.  Different versions of selectFactsForIteration
  // return either an array directly or an object with a facts/selectedFacts property.
  const selection: any = selectFactsForIteration(coverage, dimension, iteration, mode);
  let facts: any[] =
    Array.isArray(selection)
      ? selection
      : Array.isArray(selection?.facts)
      ? selection.facts
      : Array.isArray(selection?.selectedFacts)
      ? selection.selectedFacts
      : [];
  if (!facts || facts.length === 0) {
    return [];
  }
  // Build fact summaries for the LLM.  The summary includes an ID, theme,
  // a raw signal (constat), the associated managerial risk and the recommended
  // entry angle.  We rely on buildConstatFromFact and buildRiskFromFact for
  // consistency with the rest of the system.
  // Build fact summaries for the LLM.  The summary includes an ID, theme,
  // a raw signal (constat), the associated managerial risk, the recommended
  // entry angle and the current progress on the fact.  When available on
  // the fact object, we prefer the raw_signal and managerial_risk values
  // captured during initial extraction (to preserve phrasing), otherwise
  // fall back to heuristics via buildConstatFromFact and buildRiskFromFact.
  // Filter out facts that have no remaining angles to explore.  If missing_angles is
  // defined and empty, it means all angles have been covered; skip these facts.
  const candidateFacts = facts.filter((f: any) => {
    if (Array.isArray(f.missing_angles)) {
      return f.missing_angles.length > 0;
    }
    return true;
  });
  // Override facts with the filtered list for the rest of the function.  This ensures
  // that mapping and deduplication operate only on facts that still have missing angles.
  facts = candidateFacts;
  // Rebuild summaries for the remaining facts.  Prefer raw_signal or finding when
  // available to avoid injecting numeric codes from observed_element.  Carry over
  // progress and missing_angles hints for the question generator.
  const summaries: FactSummary[] = candidateFacts.map((fact: any) => {
    const rawSignal = fact.raw_signal || fact.finding || buildConstatFromFact(fact);
    const managerialRisk = fact.managerial_risk || buildRiskFromFact(fact, dimension);
    const summary: FactSummary = {
      id: String(fact.id),
      theme: String(fact.theme || ""),
      raw_signal: String(rawSignal),
      managerial_risk: String(managerialRisk),
      recommended_entry_angle: fact.recommended_entry_angle || "mechanism",
    };
    if (fact.progress) {
      summary.progress = String(fact.progress);
    }
    if (Array.isArray(fact.missing_angles)) {
      summary.missing_angles = fact.missing_angles.map((a: any) => String(a));
    }
    return summary;
  });
  // Generate questions via the LLM.  The generator returns up to two
  // questions per fact in a strict JSON format.
  const generated = await generateQuestionBatch({
    facts: summaries,
    dimension,
    iteration,
  });
  // Map generated questions back into the FactBackedQuestion structure.  We
  // lookup the original fact to reconstruct the constat and risk fields and
  // ensure the theme is preserved.
  const batch: FactBackedQuestion[] = generated.map((q) => {
    const fact: any = facts.find((f) => String(f.id) === q.fact_id) || {
      id: q.fact_id,
      theme: q.theme,
    };
    return {
      fact_id: q.fact_id,
      theme: q.theme,
      question: q.question,
      intended_angle: q.intended_angle,
      constat: buildConstatFromFact(fact),
      risque_managerial: buildRiskFromFact(fact, dimension),
    } as FactBackedQuestion;
  });
  // Deduplicate questions both within this batch and against the questions
  // already asked in the current coverage bucket.  We normalise the question
  // strings to lowercase to avoid duplicates due to casing or whitespace.
  const dimKey = toDimensionKey(dimension);
  const bucket = coverage.dimensions[dimKey];
  const previouslyAsked: string[] = Array.isArray(bucket?.asked)
    ? bucket.asked
    : [];
  const seen = new Set<string>();
  const deduped: FactBackedQuestion[] = [];
  for (const q of batch) {
    const normalized = String(q.question || "").trim().toLowerCase();
    if (!normalized) continue;
    // Build a unique key combining fact_id and intended_angle to avoid asking the
    // same angle on the same fact again.  Normalise the angle to lower case.
    const angleKey = `${q.fact_id || ""}::${(q.intended_angle || "").trim().toLowerCase()}`;
    // Skip if we've already added a question with the same text in this batch.
    if (seen.has(normalized)) continue;
    // Skip if we've already asked the same question text in a previous iteration.
    if (
      previouslyAsked.some(
        (x) => String(x || "").trim().toLowerCase() === normalized
      )
    ) {
      continue;
    }
    // Skip if the same fact and angle have been targeted previously (fact.asked_angles contains intended angle).
    const factRef = coverage.fact_inventory.find((f) => String(f.id) === q.fact_id);
    const lowerAngle = (q.intended_angle || "").trim().toLowerCase();
    if (
      factRef &&
      Array.isArray(factRef.asked_angles) &&
      factRef.asked_angles.some((a: any) => String(a || "").trim().toLowerCase() === lowerAngle)
    ) {
      continue;
    }
    seen.add(normalized);
    deduped.push(q);
  }
  // Limit the number of questions to the expected count for this iteration and mode.
  const expectedCount = expectedQuestionCount(iteration, mode as any);
  const finalBatch = deduped.slice(0, expectedCount);

  // Update coverage after the batch.  This records the questions, themes,
  // targeted fact ids and recent angles in the coverage bucket.  It also
  // increments asked_count for the underlying facts.
  updateCoverageAfterBatch(coverage, dimension, iteration, finalBatch);
  updateFactAskedCounter(coverage, finalBatch);
  return finalBatch;
}