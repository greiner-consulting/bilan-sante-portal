import OpenAI from "openai";
import type {
  CoverageState,
  DiagnosticDimensionResult,
  DiagnosticFact,
  DiagnosticResult,
  SignalProgress,
} from "@/lib/diagnostic/types";
import { normalizeText } from "@/lib/diagnostic/types";
import { dimensionName, toDimensionKey } from "@/lib/diagnostic/diagnosticContracts";
import { defaultBucket, limitUnique } from "@/lib/diagnostic/diagnosticState";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

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

function scoreFactForConsolidation(fact: DiagnosticFact): number {
  const progressScore = progressRank(fact.progress) * 25;
  const criticality = Number(fact.criticality_score || 0);
  const confidence = Number(fact.confidence_score || 0);
  const evidenceBonus = Math.min((fact.evidence_refs?.length || 0) * 6, 18);
  const contradictionPenalty = Math.min((fact.contradiction_notes?.length || 0) * 10, 25);
  const missingPenalty = Math.min((fact.missing_angles?.length || 0) * 6, 24);

  return progressScore + criticality + confidence + evidenceBonus - contradictionPenalty - missingPenalty;
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
    .sort((a, b) => scoreFactForConsolidation(b) - scoreFactForConsolidation(a));
}

function buildFactSummaryLine(fact: DiagnosticFact): string {
  const angles = (fact.asked_angles ?? []).join(", ") || "aucun";
  const missing = (fact.missing_angles ?? []).join(", ") || "aucun";
  const evidenceCount = fact.evidence_refs?.length || 0;

  return [
    `- fact_id: ${fact.id}`,
    `  theme: ${fact.theme}`,
    `  observed_element: ${fact.observed_element}`,
    `  managerial_risk: ${fact.managerial_risk || "n/a"}`,
    `  progress: ${fact.progress || "identified"}`,
    `  asked_angles: ${angles}`,
    `  missing_angles: ${missing}`,
    `  confidence_score: ${fact.confidence_score}`,
    `  criticality_score: ${fact.criticality_score}`,
    `  evidence_count: ${evidenceCount}`,
    `  contradictions: ${(fact.contradiction_notes ?? []).join(" | ") || "aucune"}`,
  ].join("\n");
}

function deterministicConstatFromFact(fact: DiagnosticFact): string {
  const observed = fact.observed_element.trim();
  const risk = (fact.managerial_risk || "").trim();

  if (fact.progress === "stabilized" || fact.progress === "consolidated") {
    if (risk) {
      return `${observed} ; le risque managérial associé apparaît désormais suffisamment étayé pour orienter la priorisation des actions.`;
    }
    return `${observed} ; ce point apparaît désormais suffisamment étayé pour être retenu comme constat structurant.`;
  }

  if (fact.progress === "arbitrated" || fact.progress === "causalized") {
    return `${observed} ; les mécanismes ou arbitrages associés sont mieux compris, mais le pilotage reste encore partiellement fragile.`;
  }

  if (fact.progress === "quantified" || fact.progress === "illustrated") {
    return `${observed} ; le point est désormais mieux objectivé, mais sa stabilisation managériale reste encore incomplète.`;
  }

  return `${observed} ; ce point reste structurant mais encore partiellement documenté ou sécurisé à ce stade.`;
}

function deterministicCauseFromFacts(facts: DiagnosticFact[]): string {
  const strongest = facts[0];

  if (!strongest) {
    return "La cause racine dominante reste partiellement à confirmer, mais semble liée à un défaut de pilotage structuré et d’arbitrage explicite.";
  }

  const theme = strongest.theme;
  const observed = strongest.observed_element;
  const risk = strongest.managerial_risk;

  if (strongest.progress === "arbitrated" || strongest.progress === "stabilized") {
    return `La cause racine dominante semble se situer autour du thème "${theme}", avec un mode de fonctionnement où ${observed.toLowerCase()} crée un défaut de pilotage ou d’arbitrage désormais visible.`;
  }

  if (strongest.progress === "causalized") {
    return `La cause racine dominante semble liée au thème "${theme}", car ${observed.toLowerCase()} renvoie à un mécanisme de fond insuffisamment maîtrisé.`;
  }

  if (risk) {
    return `La cause racine dominante semble liée au thème "${theme}", dans la mesure où ${risk.toLowerCase()}`;
  }

  return `La cause racine dominante semble se concentrer autour du thème "${theme}", encore insuffisamment piloté de manière structurée.`;
}

function deterministicZonesFromFacts(
  coverage: CoverageState,
  dimension: number,
  facts: DiagnosticFact[]
): string[] {
  const bucket = coverage.dimensions[toDimensionKey(dimension)] ?? defaultBucket(dimension);

  const fromFacts = facts
    .filter(
      (fact) =>
        fact.progress !== "stabilized" &&
        fact.progress !== "consolidated" &&
        ((fact.missing_angles?.length || 0) > 0 || (fact.contradiction_notes?.length || 0) > 0)
    )
    .map((fact) => {
      const missing = fact.missing_angles ?? [];
      if (missing.length > 0) {
        return `${fact.theme} — angles encore insuffisamment sécurisés : ${missing.join(", ")}`;
      }
      return `${fact.theme} — point encore partiellement contradictoire ou non stabilisé`;
    });

  return limitUnique(
    [
      ...fromFacts,
      ...bucket.critical_uncovered_themes,
      ...bucket.contradictions,
      ...bucket.open_hypotheses,
      ...bucket.coveredThemes.filter(
        (theme) => bucket.theme_status[normalizeText(theme)] !== "resolved"
      ),
    ],
    6
  );
}

function deterministicFallbackDimensionResult(
  coverage: CoverageState,
  dimension: number
): DiagnosticDimensionResult {
  const bucket = coverage.dimensions[toDimensionKey(dimension)] ?? defaultBucket(dimension);
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
      `Le thème "${themeFallback}" reste partiellement piloté ou insuffisamment objectivé à ce stade.`
    );
  }

  const cause = deterministicCauseFromFacts(facts);
  const zones = deterministicZonesFromFacts(coverage, dimension, facts);

  const validatedFindingsMaterial = limitUnique(
    [
      ...bucket.validated_findings,
      ...topFacts.map((f) => f.observed_element),
      ...bucket.evidences,
      ...bucket.signals,
    ],
    8
  );

  return {
    dimension,
    name: dimensionName(dimension),
    coverage_score: Math.round(bucket.sufficiency_score || 0),
    constats_cles: constats.slice(0, 3),
    cause_racine: cause,
    zones_non_pilotees: zones,
    validated_findings: validatedFindingsMaterial,
    evidences: bucket.evidences.slice(0, 8),
    signals: bucket.signals.slice(0, 8),
    open_hypotheses: bucket.open_hypotheses.slice(0, 8),
  };
}

export async function consolidateDimensionResult(params: {
  coverage: CoverageState;
  diagnosticResult: DiagnosticResult;
  extractedText: string;
  dimension: number;
}): Promise<DiagnosticResult> {
  const { coverage, diagnosticResult, extractedText, dimension } = params;
  const bucket = coverage.dimensions[toDimensionKey(dimension)] ?? defaultBucket(dimension);
  const facts = getDimensionFacts(coverage, dimension);
  const fallback = deterministicFallbackDimensionResult(coverage, dimension);

  const factMaterial =
    facts.length > 0
      ? facts.slice(0, 8).map(buildFactSummaryLine).join("\n\n")
      : "Aucun signal exploitable suffisamment structuré.";

  const prompt = `
Tu es un consultant senior en diagnostic de PME.

Tu dois consolider UNE dimension déjà explorée en 3 itérations.
Le diagnostic est structuré ; tu ne dois pas inventer de nouveaux faits.
Tu dois prioritairement t'appuyer sur les signaux les plus avancés et les mieux étayés.

Réponds STRICTEMENT en JSON :
{
  "constats_cles": ["string", "string", "string"],
  "cause_racine": "string",
  "zones_non_pilotees": ["string"]
}

Règles impératives :
- exactement 3 constats_cles
- les constats doivent être prudents, concrets, actionnables
- ne pas prêter d'intention aux personnes
- privilégier les signaux les plus avancés (stabilized, arbitrated, causalized, quantified)
- relier les constats à des mécanismes, arbitrages, zones non pilotées ou écarts répétés
- ne pas introduire de fait nouveau non présent dans le matériau
- cause_racine = une formulation dominante, pas une liste
- zones_non_pilotees = 1 à 6 éléments
- pas de texte hors JSON

DIMENSION
- ${dimension} — ${dimensionName(dimension)}

SIGNAUX DE LA DIMENSION, CLASSES PAR PRIORITE
${factMaterial}

VALIDATED FINDINGS
${bucket.validated_findings.map((x) => `- ${x}`).join("\n") || "- aucun"}

EVIDENCES
${bucket.evidences.map((x) => `- ${x}`).join("\n") || "- aucune"}

SIGNALS
${bucket.signals.map((x) => `- ${x}`).join("\n") || "- aucun"}

OPEN HYPOTHESES
${bucket.open_hypotheses.map((x) => `- ${x}`).join("\n") || "- aucune"}

CONTRADICTIONS
${bucket.contradictions.map((x) => `- ${x}`).join("\n") || "- aucune"}

CRITICAL UNCOVERED THEMES
${bucket.critical_uncovered_themes.map((x) => `- ${x}`).join("\n") || "- aucun"}

TRAME
${extractedText.slice(0, 10000)}
`.trim();

  let consolidated = fallback;

  try {
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL_CHAT || "gpt-4o-mini",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Tu consolides une dimension de diagnostic de PME. Tu ne crées pas de faits nouveaux. Réponse JSON uniquement.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);

    const constats = Array.isArray(parsed?.constats_cles)
      ? parsed.constats_cles.map(String).filter(Boolean).slice(0, 3)
      : [];
    const cause = String(parsed?.cause_racine ?? "").trim();
    const zones = Array.isArray(parsed?.zones_non_pilotees)
      ? parsed.zones_non_pilotees.map(String).filter(Boolean).slice(0, 6)
      : [];

    if (constats.length === 3 && cause) {
      consolidated = {
        ...fallback,
        constats_cles: constats,
        cause_racine: cause,
        zones_non_pilotees: zones.length > 0 ? zones : fallback.zones_non_pilotees,
      };
    }
  } catch {
    // fallback déterministe
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