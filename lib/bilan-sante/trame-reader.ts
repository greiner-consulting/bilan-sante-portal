// lib/bilan-sante/trame-reader.ts

import type {
  BaseTrameSnapshot,
  MissingFieldSignal,
  QualityFlag,
  TrameSection,
} from "@/lib/bilan-sante/session-model";
import type { DimensionId } from "@/lib/bilan-sante/protocol";

type ThemeMatcher = {
  label: string;
  dimensionId: DimensionId | null;
  patterns: RegExp[];
};

const MISSING_PATTERNS = [
  /\bnon renseign[ée]?\b/i,
  /\bnon document[ée]?\b/i,
  /\bnon suivi\b/i,
  /\bà compl[ée]ter\b/i,
  /\bn\/a\b/i,
  /\bnc\b/i,
  /\bne sait pas\b/i,
];

const THEME_MATCHERS: ThemeMatcher[] = [
  {
    label: "équipes / adéquation",
    dimensionId: 1,
    patterns: [/équipe/i, /compétence/i, /profil/i, /adéquation/i],
  },
  {
    label: "ressources / charge",
    dimensionId: 1,
    patterns: [/charge/i, /capacité/i, /sous[- ]effectif/i, /ressource/i],
  },
  {
    label: "turnover / absentéisme / stabilité",
    dimensionId: 1,
    patterns: [/turnover/i, /absent[ée]isme/i, /stabilité/i, /fidélisation/i],
  },
  {
    label: "recrutement / intégration",
    dimensionId: 1,
    patterns: [/recrut/i, /intégration/i, /onboarding/i],
  },
  {
    label: "rôles / responsabilités",
    dimensionId: 1,
    patterns: [/rôle/i, /responsabilit/i, /organigramme/i, /périmètre/i],
  },
  {
    label: "stratégie commerciale",
    dimensionId: 2,
    patterns: [/stratégie commerciale/i, /march[ée]/i, /segmentation/i, /ciblage/i],
  },
  {
    label: "portage managérial commercial",
    dimensionId: 2,
    patterns: [/déploiement commercial/i, /animation commerciale/i, /portage/i],
  },
  {
    label: "funnel / taux de succès",
    dimensionId: 2,
    patterns: [/funnel/i, /pipeline/i, /taux de succès/i, /conversion/i],
  },
  {
    label: "croissance rentable",
    dimensionId: 2,
    patterns: [/croissance rentable/i, /rentable/i, /croissance/i],
  },
  {
    label: "construction du prix",
    dimensionId: 3,
    patterns: [/prix/i, /tarif/i, /chiffrage/i, /devis/i],
  },
  {
    label: "délégation / arbitrage vente",
    dimensionId: 3,
    patterns: [/arbitrage/i, /validation devis/i, /délégation/i],
  },
  {
    label: "fiabilité du chiffrage",
    dimensionId: 3,
    patterns: [/fiabilité/i, /écart/i, /coût réel/i, /chiffrage/i],
  },
  {
    label: "sécurité / qualité / performance",
    dimensionId: 4,
    patterns: [/sécurité/i, /qualité/i, /performance/i, /non[- ]qualité/i],
  },
  {
    label: "indicateurs / rituels managériaux",
    dimensionId: 4,
    patterns: [/indicateur/i, /rituel/i, /revue/i, /pilotage/i],
  },
  {
    label: "productivité / effectifs",
    dimensionId: 4,
    patterns: [/productivité/i, /effectif/i, /charge/i, /capacité/i],
  },
  {
    label: "cash / résultat / marges",
    dimensionId: 4,
    patterns: [/cash/i, /trésorerie/i, /résultat/i, /marge/i],
  },
];

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function looksLikeHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.length > 90) return false;
  if (/^[A-Z0-9 &/()'’\-]{4,}$/.test(trimmed)) return true;
  if (/^#{1,6}\s+/.test(trimmed)) return true;
  if (/^[0-9]+(\.[0-9]+)*\s+/.test(trimmed)) return true;
  if (trimmed.endsWith(":") && trimmed.length < 70) return true;
  return false;
}

function splitSections(text: string): TrameSection[] {
  const lines = text.split("\n").map((line) => line.trim());
  const sections: TrameSection[] = [];

  let currentHeading = "Trame — contenu principal";
  let buffer: string[] = [];
  let sectionIndex = 1;

  for (const line of lines) {
    if (!line) continue;

    if (looksLikeHeading(line)) {
      if (buffer.length > 0) {
        sections.push({
          id: `section-${sectionIndex++}`,
          heading: currentHeading,
          content: buffer.join("\n").trim(),
        });
        buffer = [];
      }
      currentHeading = line.replace(/^#+\s*/, "").replace(/:$/, "").trim();
      continue;
    }

    buffer.push(line);
  }

  if (buffer.length > 0) {
    sections.push({
      id: `section-${sectionIndex++}`,
      heading: currentHeading,
      content: buffer.join("\n").trim(),
    });
  }

  if (sections.length === 0 && text.trim()) {
    sections.push({
      id: "section-1",
      heading: "Trame — contenu principal",
      content: text.trim(),
    });
  }

  return sections;
}

function detectMissingFields(sections: TrameSection[]): MissingFieldSignal[] {
  const results: MissingFieldSignal[] = [];

  for (const section of sections) {
    const rawLines = section.content.split("\n").map((line) => line.trim());

    for (const line of rawLines) {
      if (!line) continue;

      const isMissing = MISSING_PATTERNS.some((pattern) => pattern.test(line));
      if (!isMissing) continue;

      const matcher = THEME_MATCHERS.find((m) =>
        m.patterns.some((pattern) => pattern.test(line) || pattern.test(section.heading))
      );

      results.push({
        label: matcher?.label ?? section.heading,
        dimensionId: matcher?.dimensionId ?? null,
        sourceText: line,
      });
    }
  }

  return dedupeMissingFields(results);
}

function dedupeMissingFields(items: MissingFieldSignal[]): MissingFieldSignal[] {
  const seen = new Set<string>();
  const out: MissingFieldSignal[] = [];

  for (const item of items) {
    const key = `${item.dimensionId ?? "x"}|${item.label.toLowerCase()}|${item.sourceText.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}

function detectQualityFlags(text: string, sections: TrameSection[]): QualityFlag[] {
  const flags: QualityFlag[] = [];

  if (text.trim().length < 800) {
    flags.push({
      severity: "warning",
      message:
        "La trame extraite est courte. Le diagnostic reste possible, mais plusieurs thèmes risquent d’être non documentés.",
    });
  }

  if (sections.length < 3) {
    flags.push({
      severity: "info",
      message:
        "La trame paraît peu structurée. La lecture devra s’appuyer davantage sur les signaux et les absences.",
    });
  }

  if (!/[0-9]/.test(text)) {
    flags.push({
      severity: "info",
      message:
        "Aucun repère chiffré détecté dans le texte extrait. La quantification devra rester prudente et hypothétique.",
    });
  }

  if (text.trim().length === 0) {
    flags.push({
      severity: "critical",
      message: "Le texte extrait de la trame est vide.",
    });
  }

  return flags;
}

export function readBaseTrame(rawText: string): BaseTrameSnapshot {
  const normalizedText = normalizeWhitespace(String(rawText ?? ""));
  const sections = splitSections(normalizedText);
  const missingFields = detectMissingFields(sections);
  const qualityFlags = detectQualityFlags(normalizedText, sections);

  return {
    rawText: String(rawText ?? ""),
    normalizedText,
    sections,
    tables: [],
    missingFields,
    qualityFlags,
    extractedAt: new Date().toISOString(),
  };
}
