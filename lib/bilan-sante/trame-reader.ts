import type {
  BaseTrame,
  BaseTrameSnapshot,
  MissingFieldSignal,
  QualityFlag,
  TrameSection,
} from "@/lib/bilan-sante/session-model";

function compact(value: string): string {
  return String(value ?? "").replace(/\r/g, "").replace(/\s+/g, " ").trim();
}

function splitIntoSections(rawText: string): TrameSection[] {
  const normalized = String(rawText ?? "").replace(/\r/g, "");
  const parts = normalized
    .split(/\n{2,}|(?=SECTION\s+\d+)|(?=\d+\s*[). -]\s+)/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  return parts.map((part, index) => {
    const firstLine = part.split("\n")[0] ?? `Section ${index + 1}`;
    const heading = compact(firstLine).slice(0, 120) || `Section ${index + 1}`;

    return {
      id: `section-${index + 1}`,
      title: heading,
      heading,
      content: compact(part),
      sectionNumber: String(index + 1),
      qualityFlags: [],
      missingFields: [],
    };
  });
}

function deriveQualityFlags(rawText: string): QualityFlag[] {
  const flags: QualityFlag[] = [];
  const text = String(rawText ?? "").toLowerCase();

  if (text.length < 500) {
    flags.push({
      code: "TRAME_TOO_SHORT",
      severity: "warning",
      level: "warning",
      message: "La matière extraite paraît courte pour un diagnostic complet.",
    });
  }

  if (!text.includes("organisation") && !text.includes("commercial")) {
    flags.push({
      code: "TRAME_LOW_STRUCTURING",
      severity: "info",
      level: "info",
      message: "La structure explicite de la trame est peu visible dans le texte extrait.",
    });
  }

  return flags;
}

function deriveMissingFields(rawText: string): MissingFieldSignal[] {
  const missing: MissingFieldSignal[] = [];
  const text = String(rawText ?? "").toLowerCase();

  if (!text.includes("délai") && !text.includes("delai")) {
    missing.push({
      field: "délais / tenue des engagements",
      label: "délais / tenue des engagements",
      severity: "medium",
      message: "La trame expose peu explicitement la tenue des délais.",
      dimensionId: 4,
      sourceText: "",
    });
  }

  if (!text.includes("marge") && !text.includes("prix")) {
    missing.push({
      field: "prix / marge",
      label: "prix / marge",
      severity: "low",
      message: "La trame mentionne peu le pilotage économique ou prix.",
      dimensionId: 3,
      sourceText: "",
    });
  }

  return missing;
}

export function readBaseTrame(rawText: string): BaseTrame {
  const sections = splitIntoSections(rawText);
  const qualityFlags = deriveQualityFlags(rawText);
  const missingFields = deriveMissingFields(rawText);

  const snapshot: BaseTrameSnapshot = {
    rawText: String(rawText ?? ""),
    sections,
    qualityFlags,
    missingFields,
    extractedAt: new Date().toISOString(),
  };

  return snapshot;
}

export type {
  BaseTrame,
  BaseTrameSnapshot,
  MissingFieldSignal,
  QualityFlag,
  TrameSection,
};