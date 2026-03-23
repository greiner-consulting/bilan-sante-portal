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

type ExtractionItem = {
  dimension: DimensionId;
  finding: string;
  managerial_risk: string;
  facts: string[];
  recommendation?: string;
  evidence_level: EvidenceLevel;
  confidence_score: number;
};

function splitParagraphs(content: string) {
  return String(content || "")
    .split(/\n\s*\n/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function inferDimensionFromText(text: string): DimensionId | null {
  const t = normalizeText(text);

  const scoreByDimension: Record<DimensionId, number> = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
  };

  const rules: Array<{ dimension: DimensionId; terms: string[] }> = [
    {
      dimension: 1,
      terms: [
        "gouvernance",
        "organisation",
        "management",
        "rh",
        "relais",
        "encadrement",
        "competences",
        "climat social",
      ],
    },
    {
      dimension: 2,
      terms: [
        "commercial",
        "clients",
        "prospection",
        "marche",
        "pipeline",
        "portefeuille",
        "segmentation",
        "conquete",
      ],
    },
    {
      dimension: 3,
      terms: [
        "prix",
        "tarification",
        "marge",
        "negociation",
        "rentabilite affaire",
        "go/no go",
        "selectivite",
        "cycle de vente",
      ],
    },
    {
      dimension: 4,
      terms: [
        "execution",
        "operationnel",
        "qualite",
        "delais",
        "productivite",
        "derive",
        "charge",
        "capacite",
      ],
    },
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

function paragraphToExtractionItem(paragraph: string): ExtractionItem | null {
  const dimension = inferDimensionFromText(paragraph);
  if (!dimension) return null;

  const finding = buildFinding(paragraph);
  if (finding.length < 25) return null;

  const facts = extractFactsFromParagraph(paragraph);
  const evidence_level = inferEvidenceLevel(paragraph);

  return {
    dimension,
    finding,
    managerial_risk: buildManagerialRisk(paragraph, dimension),
    facts,
    recommendation: buildRecommendation(dimension),
    evidence_level,
    confidence_score:
      evidence_level === "high" ? 80 : evidence_level === "medium" ? 65 : 50,
  };
}

export function extractPatternsFromLegacyDiagnostic(
  input: LegacyDiagnosticInput
): KnowledgePattern[] {
  const paragraphs = splitParagraphs(input.content);
  const patterns: KnowledgePattern[] = [];

  for (const paragraph of paragraphs) {
    const item = paragraphToExtractionItem(paragraph);
    if (!item) continue;

    const themes = inferThemes(
      item.dimension,
      [paragraph, item.finding, item.managerial_risk].join(" "),
      4
    );

    patterns.push({
      id: buildPatternId({
        source_ref: input.source_ref,
        dimension: item.dimension,
        finding: item.finding,
        managerial_risk: item.managerial_risk,
      }),
      source_type: "legacy_diagnostic",
      source_ref: input.source_ref,
      dimension: item.dimension,
      themes,
      facts: item.facts,
      finding: item.finding,
      managerial_risk: item.managerial_risk,
      recommendation: item.recommendation,
      evidence_level: item.evidence_level,
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
      confidence_score: item.confidence_score,
      created_at: new Date().toISOString(),
    });
  }

  return patterns;
}

export function ingestLegacyDiagnostics(
  inputs: LegacyDiagnosticInput[]
): KnowledgeBase {
  const patterns = inputs.flatMap((input) =>
    extractPatternsFromLegacyDiagnostic(input)
  );

  return createKnowledgeBase(patterns);
}