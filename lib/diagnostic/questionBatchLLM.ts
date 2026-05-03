import type { CoverageState, FactBackedQuestion } from "@/lib/diagnostic/types";
import {
  selectFactsForIteration,
  buildConstatFromFact,
  buildRiskFromFact,
  updateFactAskedCounter,
} from "@/lib/diagnostic/diagnosticState";
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
  const facts: any[] =
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
  const summaries: FactSummary[] = facts.map((fact: any) => {
    return {
      id: String(fact.id),
      theme: String(fact.theme || ""),
      raw_signal: buildConstatFromFact(fact),
      managerial_risk: buildRiskFromFact(fact, dimension),
      recommended_entry_angle: fact.recommended_entry_angle || "mechanism",
    };
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
  // Update coverage so that the selected facts are marked as asked.  This
  // prevents the same facts from being reused in subsequent iterations.
  updateFactAskedCounter(coverage, batch.map((q) => q.fact_id));
  return batch;
}