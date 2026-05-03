import {
  type DimensionId,
  type EvidenceLevel,
  type KnowledgeBase,
  type KnowledgePattern,
  type LegacyDiagnosticInput,
  buildPatternId,
  createKnowledgeBase,
  inferThemes,
  normalizeText,
  uniqueStrings,
} from "@/lib/diagnostic/knowledgeBase";
import { DIMENSION_GUARDRAILS } from "@/lib/diagnostic/diagnosticContracts";
import { extractFactsFromText, DimensionSpec, ExtractedFact } from "./factExtractorLLM";

/*
 * legacyDiagnosticIngestion.ts (modified)
 *
 * This revised module replaces the heuristic extraction logic with a call to
 * a language‑model‑based fact extractor.  For each dimension (1–4), it
 * composes a dimension specification (name, investigation goals, allowed
 * themes, forbidden themes and confusion risks) from DIMENSION_GUARDRAILS
 * and passes the entire document to extractFactsFromText.  The resulting
 * facts are normalised into knowledge patterns.  If the LLM extraction
 * returns no facts for a dimension, the function falls back to the original
 * heuristic extraction logic (split paragraphs, infer dimensions, etc.).
 */

// Local helper to build a recommendation based on dimension.
function buildRecommendation(dimension: DimensionId) {
  if (dimension === 1) {
    return "Clarifier les responsabilités, sécuriser les relais et formaliser les rituels de pilotage managérial.";
  }
  if (dimension === 2) {
    return "Reprioriser le portefeuille, expliciter le ciblage et structurer la discipline commerciale.";
  }
  if (dimension === 3) {
    return "Renforcer les règles de tarification, de négociation et de sélectivité économique.";
  }
  return "Renforcer les rituels de pilotage, le traitement des écarts et la coordination inter-fonctions.";
}

// Heuristic fallback extraction from the previous implementation.  These
// functions (inferDimensionFromText, inferEvidenceLevel, extractFactsFromParagraph,
// buildFinding, buildManagerialRisk) are preserved as fallbacks when the
// LLM extraction fails to yield any patterns.
function splitParagraphs(content: string) {
  return String(content || "")
    .split(/\n\s*\n/g)
    .map((x) => x.trim())
    .filter(Boolean);
}
function inferDimensionFromText(text: string): DimensionId | null {
  const t = normalizeText(text);
  const scoreByDimension: Record<DimensionId, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const rules: Array<{ dimension: DimensionId; terms: string[] }> = [
    { dimension: 1, terms: ["gouvernance", "organisation", "management", "rh", "relais", "encadrement", "competences", "climat social"] },
    { dimension: 2, terms: ["commercial", "clients", "prospection", "marche", "pipeline", "portefeuille", "segmentation", "conquete"] },
    { dimension: 3, terms: ["prix", "tarification", "marge", "negociation", "rentabilite affaire", "go/no go", "selectivite", "cycle de vente"] },
    { dimension: 4, terms: ["execution", "operationnel", "qualite", "delais", "productivite", "derive", "charge", "capacite"] },
  ];
  for (const rule of rules) {
    for (const term of rule.terms) {
      if (t.includes(normalizeText(term))) {
        scoreByDimension[rule.dimension] += 1;
      }
    }
  }
  const entries = Object.entries(scoreByDimension) as Array<[string, number]>;
  entries.sort((a, b) => b[1] - a[1]);
  if (!entries[0] || entries[0][1] === 0) return null;
  return Number(entries[0][0]) as DimensionId;
}
function inferEvidenceLevel(text: string): EvidenceLevel {
  const t = normalizeText(text);
  if (
    t.includes("mesure") ||
    t.includes("indicateur") ||
    t.includes("chiffre") ||
    t.includes("constate") ||
    t.includes("observe") ||
    t.includes("documente")
  ) {
    return "high";
  }
  if (
    t.includes("semble") ||
    t.includes("probable") ||
    t.includes("laisse penser") ||
    t.includes("partiellement")
  ) {
    return "medium";
  }
  return "low";
}
function extractFactsFromParagraph(text: string): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const facts = sentences.filter((sentence) => {
    const s = normalizeText(sentence);
    return (
      s.includes("absence de") ||
      s.includes("depend") ||
      s.includes("retard") ||
      s.includes("derive") ||
      s.includes("concentration") ||
      s.includes("non formalise") ||
      s.includes("pas de") ||
      s.includes("faible") ||
      s.includes("insuffisant") ||
      s.includes("aucun") ||
      s.includes("ecart")
    );
  });
  return uniqueStrings(facts).slice(0, 3);
}
function buildFinding(text: string) {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  return sentences[0] || text.trim();
}
function buildManagerialRisk(text: string, dimension: DimensionId) {
  const base = buildFinding(text);
  if (dimension === 1) {
    return `Sans clarification de cette fragilité organisationnelle, l'entreprise risque de dépendre d'arbitrages peu robustes et de relais managériaux insuffisamment sécurisés à partir du constat suivant : ${base}`;
  }
  if (dimension === 2) {
    return `Sans traitement de cette fragilité commerciale, l'entreprise risque de subir une allocation inefficace de ses efforts de conquête et une dépendance excessive à certains segments ou clients à partir du constat suivant : ${base}`;
  }
  if (dimension === 3) {
    return `Sans discipline économique plus robuste, l'entreprise risque de poursuivre des affaires insuffisamment rentables ou de dégrader sa capacité de négociation à partir du constat suivant : ${base}`;
  }
  return `Sans traitement de cette fragilité opérationnelle, l'entreprise risque de prolonger des dérives d'exécution, de qualité ou de productivité à partir du constat suivant : ${base}`;
}

// Main extraction function.  Attempts LLM extraction first, then falls back to heuristics.
export async function extractPatternsFromLegacyDiagnostic(
  input: LegacyDiagnosticInput
): Promise<KnowledgePattern[]> {
  const text = String(input.content || "");
  const allPatterns: KnowledgePattern[] = [];
  // Attempt LLM-based extraction for each dimension.
  for (const dimensionId of [1, 2, 3, 4] as DimensionId[]) {
    const guard = DIMENSION_GUARDRAILS[dimensionId];
    const spec: DimensionSpec = {
      id: dimensionId,
      name: guard.name,
      investigationGoals: guard.investigationGoals,
      allowedThemes: guard.allowedThemes,
      forbiddenThemes: guard.forbiddenThemes,
      confusionRisks: guard.confusionRisks,
    };
    try {
      const facts = await extractFactsFromText({ document: text, dimension: spec });
      for (const fact of facts) {
        const themes = inferThemes(
          dimensionId,
          [text, fact.raw_signal, fact.managerial_risk].join(" "),
          4
        );
        const evidenceLevel: EvidenceLevel = fact.proof_level >= 3 ? "high" : fact.proof_level === 2 ? "medium" : "low";
        allPatterns.push({
          id: buildPatternId({
            source_ref: input.source_ref,
            dimension: dimensionId,
            finding: fact.raw_signal,
            managerial_risk: fact.managerial_risk,
          }),
          source_type: "legacy_diagnostic",
          source_ref: input.source_ref,
          dimension: dimensionId,
          themes,
          facts: [],
          finding: fact.raw_signal,
          managerial_risk: fact.managerial_risk,
          recommendation: buildRecommendation(dimensionId),
          evidence_level: evidenceLevel,
          context_tags: uniqueStrings([
            input.company_name || "",
            input.sector || "",
            input.size_band || "",
            input.geography || "",
          ]).filter(Boolean),
          company_profile: input.company_name,
          sector: input.sector,
          size_band: input.size_band,
          geography: input.geography,
          confidence_score: fact.confidence_score,
          created_at: new Date().toISOString(),
        });
      }
    } catch {
      // ignore LLM errors for this dimension
    }
  }
  // If no patterns were produced by the LLM, fall back to heuristics.
  if (allPatterns.length > 0) {
    return allPatterns;
  }
  const paragraphs = splitParagraphs(text);
  const patterns: KnowledgePattern[] = [];
  for (const paragraph of paragraphs) {
    const dimension = inferDimensionFromText(paragraph);
    if (!dimension) continue;
    const finding = buildFinding(paragraph);
    if (finding.length < 25) continue;
    const facts = extractFactsFromParagraph(paragraph);
    const evidence_level = inferEvidenceLevel(paragraph);
    patterns.push({
      id: buildPatternId({
        source_ref: input.source_ref,
        dimension,
        finding,
        managerial_risk: buildManagerialRisk(paragraph, dimension),
      }),
      source_type: "legacy_diagnostic",
      source_ref: input.source_ref,
      dimension,
      themes: inferThemes(
        dimension,
        [paragraph, finding, buildManagerialRisk(paragraph, dimension)].join(" "),
        4
      ),
      facts,
      finding,
      managerial_risk: buildManagerialRisk(paragraph, dimension),
      recommendation: buildRecommendation(dimension),
      evidence_level,
      context_tags: uniqueStrings([
        input.company_name || "",
        input.sector || "",
        input.size_band || "",
        input.geography || "",
      ]).filter(Boolean),
      company_profile: input.company_name,
      sector: input.sector,
      size_band: input.size_band,
      geography: input.geography,
      confidence_score:
        evidence_level === "high" ? 80 : evidence_level === "medium" ? 65 : 50,
      created_at: new Date().toISOString(),
    });
  }
  return patterns;
}

export async function ingestLegacyDiagnostics(
  inputs: LegacyDiagnosticInput[]
): Promise<KnowledgeBase> {
  const patterns = (
    await Promise.all(inputs.map((input) => extractPatternsFromLegacyDiagnostic(input)))
  ).flat();
  return createKnowledgeBase(patterns);
}