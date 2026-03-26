// lib/bilan-sante/signal-extraction-contract.ts

import type { DimensionId } from "@/lib/bilan-sante/protocol";
import type { DiagnosticSignal } from "@/lib/bilan-sante/session-model";

export type SignalEntryAngle = DiagnosticSignal["entryAngle"];

export type EvidenceNature =
  | "structural"
  | "illustrative"
  | "anecdotal"
  | "unclear";

export type UncoveredThemeReason =
  | "no_evidence"
  | "only_illustrative"
  | "only_anecdotal"
  | "too_weak"
  | "not_enough_material";

export type LlmExtractedExplicitSignal = {
  theme: string;
  sourceSectionId: string;
  sourceExcerpt: string;
  evidenceNature: EvidenceNature;
  entryAngle: SignalEntryAngle;
  relevanceScore: number;
  confidenceScore: number;
  criticalityScore: number;
  constat: string;
  managerialRisk: string;
  probableConsequence: string;
  whyRelevant: string;
};

export type LlmUncoveredTheme = {
  theme: string;
  reason: UncoveredThemeReason;
  confidenceScore: number;
  whyMissing: string;
};

export type LlmSignalExtractionResponse = {
  dimensionId: DimensionId;
  explicitSignals: LlmExtractedExplicitSignal[];
  uncoveredThemes: LlmUncoveredTheme[];
};

export const MIN_RELEVANCE_SCORE = 55;
export const MIN_CONFIDENCE_SCORE = 50;
export const MIN_ILLUSTRATIVE_RELEVANCE_SCORE = 70;
export const MAX_SIGNALS_PER_THEME = 1;
export const MAX_SECTION_REUSE_BEFORE_HARD_PENALTY = 2;

const EVIDENCE_RANK: Record<EvidenceNature, number> = {
  structural: 4,
  unclear: 3,
  illustrative: 2,
  anecdotal: 1,
};

export function normalizeExtractionText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function clampScore(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

export function isEvidenceNature(value: unknown): value is EvidenceNature {
  return (
    value === "structural" ||
    value === "illustrative" ||
    value === "anecdotal" ||
    value === "unclear"
  );
}

export function isSignalEntryAngle(value: unknown): value is SignalEntryAngle {
  return (
    value === "causality" ||
    value === "arbitration" ||
    value === "economics" ||
    value === "formalization" ||
    value === "dependency" ||
    value === "mechanism"
  );
}

export function isUncoveredThemeReason(
  value: unknown
): value is UncoveredThemeReason {
  return (
    value === "no_evidence" ||
    value === "only_illustrative" ||
    value === "only_anecdotal" ||
    value === "too_weak" ||
    value === "not_enough_material"
  );
}

export function evidenceNatureRank(value: EvidenceNature): number {
  return EVIDENCE_RANK[value] ?? 0;
}