import OpenAI from "openai";
import type {
  CoverageState,
  DiagnosticDimensionResult,
  DiagnosticFact,
  DiagnosticResult,
  SignalProgress,
} from "@/lib/diagnostic/types";
import { normalizeText } from "@/lib/diagnostic/types";
import {
  dimensionName,
  toDimensionKey,
} from "@/lib/diagnostic/diagnosticContracts";
import { defaultBucket, limitUnique } from "@/lib/diagnostic/diagnosticState";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

function cleanSentence(value: string, maxLength = 360): string {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\.\.\.+/g, ".")
    .trim();

  if (!text) return "";

  if (text.length <= maxLength) {
    return ensureFinalPunctuation(text);
  }

  const cut = text.slice(0, maxLength);
  const lastStop = Math.max(
    cut.lastIndexOf("."),
    cut.lastIndexOf(";"),
    cut.lastIndexOf(",")
  );

  if (lastStop > 140) {
    return ensureFinalPunctuation(cut.slice(0, lastStop).trim());
  }

  return ensureFinalPunctuation(cut.trim());
}

function ensureFinalPunctuation(value: string): string {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/[.!?]$/.test(text)) return text;
  return `${text}.`;
}

function removeEllipses(value: string): string {
  return String(value || "")
    .replace(/\.\.\.+/g, ".")
    .replace(/\s+\./g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeArray(values: unknown[], max = 8): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const value of values || []) {
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

function progressRank(progress?: SignalProgress): number {
  switch (progress) {
    case "consolidated":
      return 8;
    case "stabilized":
      return 7;
    case "arbitrated":
      return 6;
    case "causalized":
      return 5;
    case "quantified":
      return 4;
    case "illustrated":
      return 3;
    case "questioned":
      return 2;
    case "identified":
      return 1;
    default:
      return 0;
  }
}

function hasNumericValues(fact: DiagnosticFact): boolean {
  return Boolean(
    fact.numeric_values &&
      typeof fact.numeric_values === "object" &&
      Object.keys(fact.numeric_values).length > 0
  );
}

function numericValuesToText(fact: DiagnosticFact): string {
  if (!hasNumericValues(fact)) return "";

  return Object.entries(fact.numeric_values as Record<string, number | string>)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" | ");
}

function getFactTagValue(fact: DiagnosticFact, prefix: string): string | null {
  for (const tag of fact.tags ?? []) {
    const text = String(tag || "").trim();
    if (!text.startsWith(prefix)) continue;
    return text.slice(prefix.length).trim() || null;
  }
  return null;
}

function getDiagnosticStatement(fact: DiagnosticFact): string {
  const rawFact = fact as any;

  return cleanSentence(
    String(
      rawFact.diagnostic_statement ||
        getFactTagValue(fact, "diagnostic_statement:") ||
        rawFact.raw_signal ||
        getFactTagValue(fact, "raw_signal:") ||
        fact.observed_element ||
        fact.source_excerpt ||
        ""
    ),
    420
  );
}

function getFactMemory(fact: DiagnosticFact) {
  const rawFact = fact as any;

  return {
    previous_questions: normalizeArray(rawFact.previous_questions || [], 5),
    previous_answers: normalizeArray(rawFact.previous_answers || [], 5),
    answer_summaries: normalizeArray(rawFact.answer_summaries || [], 5),
    validated_findings: normalizeArray(
      [...(rawFact.validated_findings || []), ...(fact.evidence_refs || [])],
      5
    ),
    open_hypotheses: normalizeArray(rawFact.open_hypotheses || [], 5),
    contradictions: normalizeArray(fact.contradiction_notes || [], 5),
  };
}

function scoreFactForConsolidation(fact: DiagnosticFact): number {
  const progressScore = progressRank(fact.progress) * 25;
  const criticality = Number(fact.criticality_score || 0);
  const confidence = Number(fact.confidence_score || 0);
  const evidenceBonus = Math.min((fact.evidence_refs?.length || 0) * 6, 18);
  const numericBonus = hasNumericValues(fact) ? 35 : 0;
  const sourceBonus = String(fact.source_excerpt || "").trim().length >= 40 ? 20 : 0;
  const memoryBonus =
    getFactMemory(fact).previous_answers.length > 0 ||
    getFactMemory(fact).answer_summaries.length > 0
      ? 20
      : 0;
  const contradictionPenalty = Math.min(
    (fact.contradiction_notes?.length || 0) * 10,
    25
  );
  const missingPenalty = Math.min((fact.missing_angles?.length || 0) * 5, 20);

  return (
    progressScore +
    criticality +
    confidence +
    evidenceBonus +
    numericBonus +
    sourceBonus +
    memoryBonus -
    contradictionPenalty -
    missingPenalty
  );
}

function getDimensionFacts(
  coverage: CoverageState,
  dimension: number
): DiagnosticFact[] {
  return coverage.fact_inventory
    .filter(
      (fact) =>
        fact.dimension_primary === dimension &&
        fact.reasoning_status !== "refuted" &&
        fact.reasoning_status !== "contradicted"
    )
    .sort(
      (a, b) => scoreFactForConsolidation(b) - scoreFactForConsolidation(a)
    );
}

function buildFactSummaryLine(fact: DiagnosticFact): string {
  const memory = getFactMemory(fact);
  const numeric = numericValuesToText(fact);
  const statement = getDiagnosticStatement(fact);
  const angles = (fact.asked_angles ?? []).join(", ") || "aucun";
  const missing = (fact.missing_angles ?? []).join(", ") || "aucun";

  return [
    `- fact_id: ${fact.id}`,
    `  theme: ${fact.theme}`,
    `  diagnostic_statement: ${statement}`,
    `  source_excerpt: ${cleanSentence(String(fact.source_excerpt || ""), 420) || "n/a"}`,
    `  numeric_values: ${numeric || "aucun"}`,
    `  managerial_risk: ${cleanSentence(fact.managerial_risk || "", 360) || "n/a"}`,
    `  progress: ${fact.progress || "identified"}`,
    `  asked_angles: ${angles}`,
    `  missing_angles: ${missing}`,
    `  previous_answers: ${memory.previous_answers.join(" | ") || "aucune"}`,
    `  answer_summaries: ${memory.answer_summaries.join(" | ") || "aucun"}`,
    `  validated_findings: ${memory.validated_findings.join(" | ") || "aucun"}`,
    `  open_hypotheses: ${memory.open_hypotheses.join(" | ") || "aucune"}`,
    `  contradictions: ${memory.contradictions.join(" | ") || "aucune"}`,
    `  confidence_score: ${fact.confidence_score}`,
    `  criticality_score: ${fact.criticality_score}`,
  ].join("\n");
}

function deterministicConstatFromFact(fact: DiagnosticFact): string {
  const statement = getDiagnosticStatement(fact);
  const numeric = numericValuesToText(fact);
  const memory = getFactMemory(fact);

  const answerMaterial =
    memory.answer_summaries[0] ||
    memory.previous_answers[0] ||
    memory.validated_findings[0] ||
    "";

  if (numeric) {
    return cleanSentence(
      `${statement} Les éléments chiffrés associés (${numeric}) doivent être retenus comme un point de pilotage prioritaire.`
    );
  }

  if (answerMaterial) {
    return cleanSentence(
      `${statement} Les réponses recueillies confirment ou précisent ce point : ${answerMaterial}`
    );
  }

  if (fact.progress === "arbitrated" || fact.progress === "causalized") {
    return cleanSentence(
      `${statement} Le mécanisme ou l'arbitrage associé est désormais mieux identifié, mais sa maîtrise opérationnelle reste à sécuriser.`
    );
  }

  if (fact.progress === "quantified" || fact.progress === "illustrated") {
    return cleanSentence(
      `${statement} Le point est mieux objectivé, mais il reste à stabiliser dans le pilotage courant.`
    );
  }

  return cleanSentence(
    `${statement} Ce point reste structurant pour la dimension et doit être clarifié dans le plan d'action.`
  );
}

function deterministicCauseFromFacts(facts: DiagnosticFact[]): string {
  const topFacts = facts.slice(0, 3);
  const strongest = topFacts[0];

  if (!strongest) {
    return "La cause racine dominante reste liée à un déficit de pilotage structuré et d'arbitrage explicite.";
  }

  const statement = getDiagnosticStatement(strongest);
  const risk = cleanSentence(strongest.managerial_risk || "", 260);

  if (risk) {
    return cleanSentence(
      `La cause racine dominante tient au fait que ${statement.toLowerCase()} ${risk.toLowerCase()}`
    );
  }

  return cleanSentence(
    `La cause racine dominante tient au fait que ${statement.toLowerCase()}`
  );
}

function deterministicZonesFromFacts(
  coverage: CoverageState,
  dimension: number,
  facts: DiagnosticFact[]
): string[] {
  const bucket =
    coverage.dimensions[toDimensionKey(dimension)] ?? defaultBucket(dimension);

  const fromFacts = facts
    .filter(
      (fact) =>
        fact.progress !== "stabilized" &&
        fact.progress !== "consolidated" &&
        ((fact.missing_angles?.length || 0) > 0 ||
          (fact.contradiction_notes?.length || 0) > 0)
    )
    .map((fact) => {
      const missing = fact.missing_angles ?? [];
      const statement = getDiagnosticStatement(fact);

      if (missing.length > 0) {
        return cleanSentence(
          `${statement} Les angles encore à sécuriser sont : ${missing.join(", ")}`
        );
      }

      return cleanSentence(
        `${statement} Le point reste partiellement contradictoire ou non stabilisé.`
      );
    });

  return limitUnique(
    [
      ...fromFacts,
      ...bucket.critical_uncovered_themes.map((theme) =>
        cleanSentence(`Le thème "${theme}" reste insuffisamment piloté.`)
      ),
      ...bucket.contradictions,
      ...bucket.open_hypotheses,
      ...bucket.coveredThemes
        .filter((theme) => bucket.theme_status[normalizeText(theme)] !== "resolved")
        .map((theme) => cleanSentence(`Le thème "${theme}" n'est pas totalement résolu.`)),
    ],
    6
  ).map((x) => cleanSentence(x, 300));
}

function sanitizeConstats(values: unknown[], fallback: string[]): string[] {
  const clean = normalizeArray(values, 3)
    .map((x) => removeEllipses(x))
    .map((x) => cleanSentence(x, 360))
    .filter((x) => x.length >= 40 && !x.includes("..."));

  const merged = limitUnique([...clean, ...fallback], 3).map((x) =>
    cleanSentence(removeEllipses(x), 360)
  );

  while (merged.length < 3) {
    merged.push(
      cleanSentence(
        "Le diagnostic de cette dimension reste partiellement documenté et doit être sécurisé par des arbitrages explicites."
      )
    );
  }

  return merged.slice(0, 3);
}

function sanitizeCause(value: unknown, fallback: string): string {
  const cause = cleanSentence(removeEllipses(String(value || "")), 420);
  if (cause.length >= 40 && !cause.includes("...")) return cause;
  return cleanSentence(fallback, 420);
}

function sanitizeZones(values: unknown[], fallback: string[]): string[] {
  const clean = normalizeArray(values, 6)
    .map((x) => cleanSentence(removeEllipses(x), 300))
    .filter((x) => x.length >= 25 && !x.includes("..."));

  const merged = limitUnique([...clean, ...fallback], 6).map((x) =>
    cleanSentence(removeEllipses(x), 300)
  );

  return merged.slice(0, 6);
}

function deterministicFallbackDimensionResult(
  coverage: CoverageState,
  dimension: number
): DiagnosticDimensionResult {
  const bucket =
    coverage.dimensions[toDimensionKey(dimension)] ?? defaultBucket(dimension);
  const facts = getDimensionFacts(coverage, dimension).slice(0, 8);

  const topFacts = facts.slice(0, 3);
  const constats =
    topFacts.length > 0
      ? topFacts.map(deterministicConstatFromFact).slice(0, 3)
      : [];

  while (constats.length < 3) {
    const themeFallback =
      bucket.critical_uncovered_themes[constats.length] ||
      bucket.coveredThemes[constats.length] ||
      `thème ${constats.length + 1}`;

    constats.push(
      cleanSentence(
        `Le thème "${themeFallback}" reste partiellement piloté ou insuffisamment objectivé à ce stade.`
      )
    );
  }

  const cause = deterministicCauseFromFacts(facts);
  const zones = deterministicZonesFromFacts(coverage, dimension, facts);

  const validatedFindingsMaterial = limitUnique(
    [
      ...bucket.validated_findings,
      ...topFacts.map((f) => getDiagnosticStatement(f)),
      ...bucket.evidences,
      ...bucket.signals,
    ],
    8
  ).map((x) => cleanSentence(x, 360));

  return {
    dimension,
    name: dimensionName(dimension),
    coverage_score: Math.round(bucket.sufficiency_score || 0),
    constats_cles: constats.slice(0, 3),
    cause_racine: cause,
    zones_non_pilotees: zones,
    validated_findings: validatedFindingsMaterial,
    evidences: bucket.evidences.slice(0, 8).map((x) => cleanSentence(x, 360)),
    signals: bucket.signals.slice(0, 8).map((x) => cleanSentence(x, 360)),
    open_hypotheses: bucket.open_hypotheses
      .slice(0, 8)
      .map((x) => cleanSentence(x, 360)),
  };
}

export async function consolidateDimensionResult(params: {
  coverage: CoverageState;
  diagnosticResult: DiagnosticResult;
  extractedText: string;
  dimension: number;
}): Promise<DiagnosticResult> {
  const { coverage, diagnosticResult, extractedText, dimension } = params;
  const bucket =
    coverage.dimensions[toDimensionKey(dimension)] ?? defaultBucket(dimension);
  const facts = getDimensionFacts(coverage, dimension);
  const fallback = deterministicFallbackDimensionResult(coverage, dimension);

  const factMaterial =
    facts.length > 0
      ? facts.slice(0, 10).map(buildFactSummaryLine).join("\n\n")
      : "Aucun signal exploitable suffisamment structuré.";

  const prompt = `
Tu es un consultant senior en diagnostic de PME.

Tu dois consolider UNE dimension déjà explorée en 3 itérations.
Tu ne dois pas inventer de nouveaux faits.
Tu dois produire une synthèse claire, courte, exploitable par un dirigeant.

Réponds STRICTEMENT en JSON :
{
  "constats_cles": ["string", "string", "string"],
  "cause_racine": "string",
  "zones_non_pilotees": ["string"]
}

RÈGLES IMPÉRATIVES :
- exactement 3 constats_cles ;
- chaque constat doit être une phrase complète, terminée, sans "..." ;
- chaque constat doit rester simple : maximum deux idées par phrase ;
- ne fais pas de phrase trop longue ;
- les constats doivent être fondés sur les faits fournis ;
- si un chiffre existe dans le matériau, il doit être repris dans au moins un constat ou dans la cause racine ;
- si des réponses dirigeant existent, elles doivent être prises en compte ;
- cause_racine = une seule cause dominante, formulée simplement ;
- zones_non_pilotees = 1 à 6 éléments concrets ;
- ne pas prêter d'intention aux personnes ;
- ne pas introduire de fait nouveau ;
- aucun texte hors JSON.

STYLE ATTENDU :
- phrases courtes ;
- vocabulaire de diagnostic opérationnel ;
- formulation prudente mais utile ;
- pas de jargon inutile ;
- pas d'ellipse ;
- pas de liste déguisée dans une seule phrase.

DIMENSION
- ${dimension} — ${dimensionName(dimension)}

SIGNAUX DE LA DIMENSION, CLASSÉS PAR PRIORITÉ
${factMaterial}

VALIDATED FINDINGS
${bucket.validated_findings.map((x) => `- ${cleanSentence(x, 300)}`).join("\n") || "- aucun"}

EVIDENCES
${bucket.evidences.map((x) => `- ${cleanSentence(x, 300)}`).join("\n") || "- aucune"}

SIGNALS
${bucket.signals.map((x) => `- ${cleanSentence(x, 300)}`).join("\n") || "- aucun"}

OPEN HYPOTHESES
${bucket.open_hypotheses.map((x) => `- ${cleanSentence(x, 300)}`).join("\n") || "- aucune"}

CONTRADICTIONS
${bucket.contradictions.map((x) => `- ${cleanSentence(x, 300)}`).join("\n") || "- aucune"}

CRITICAL UNCOVERED THEMES
${bucket.critical_uncovered_themes.map((x) => `- ${x}`).join("\n") || "- aucun"}

TRAME
${extractedText.slice(0, 12000)}
`.trim();

  let consolidated = fallback;

  try {
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL_CHAT || "gpt-4o-mini",
      temperature: 0.05,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Tu consolides une dimension de diagnostic de PME. Tu ne crées pas de faits nouveaux. JSON uniquement.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);

    const constats = sanitizeConstats(parsed?.constats_cles || [], fallback.constats_cles);
    const cause = sanitizeCause(parsed?.cause_racine, fallback.cause_racine);
    const zones = sanitizeZones(
      parsed?.zones_non_pilotees || [],
      fallback.zones_non_pilotees
    );

    consolidated = {
      ...fallback,
      constats_cles: constats,
      cause_racine: cause,
      zones_non_pilotees: zones.length > 0 ? zones : fallback.zones_non_pilotees,
    };
  } catch {
    consolidated = fallback;
  }

  const nextDimensions = [
    ...diagnosticResult.dimensions.filter((d) => d.dimension !== dimension),
    consolidated,
  ].sort((a, b) => a.dimension - b.dimension);

  return {
    ...diagnosticResult,
    dimensions: nextDimensions,
  };
}