import OpenAI from "openai";
import type {
  QuestionCandidate,
  QuestionJudgeInput,
  QuestionJudgment,
  QuestionJudgmentViolation,
} from "@/lib/diagnostic/types";
import {
  clampScore0to100,
  inferDisplayModeFromFact,
  normalizeText,
  normalizeTheme,
} from "@/lib/diagnostic/types";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

function containsAny(text: string, patterns: string[]) {
  return patterns.some((pattern) => text.includes(pattern));
}

function deterministicViolations(
  input: QuestionJudgeInput
): QuestionJudgmentViolation[] {
  const violations: QuestionJudgmentViolation[] = [];
  const { fact, candidate, allowedThemes, forbiddenThemes, iteration } = input;

  const question = normalizeText(candidate.question);
  const anchor = normalizeText(candidate.anchor);
  const hypothesis = normalizeText(candidate.hypothesis || "");
  const risk = normalizeText(candidate.managerial_risk || "");
  const theme = normalizeTheme(candidate.theme);

  if (!allowedThemes.map(normalizeTheme).includes(theme)) {
    violations.push({
      criterion: "factual_anchor",
      severity: "high",
      message: "Le thème de la question n'appartient pas aux thèmes autorisés.",
    });
  }

  if (forbiddenThemes.map(normalizeTheme).includes(theme)) {
    violations.push({
      criterion: "factual_anchor",
      severity: "high",
      message: "Le thème de la question est explicitement interdit pour cette dimension.",
    });
  }

  if (fact.proof_level <= 2 && candidate.display_mode !== "point_to_clarify") {
    violations.push({
      criterion: "proof_discipline",
      severity: "high",
      message:
        "Quand la preuve est faible, le mode d'affichage doit rester au niveau 'point à clarifier'.",
    });
  }

  if (fact.proof_level <= 2) {
    const forbiddenStrongPatterns = [
      "est en difficulte",
      "sont en difficulte",
      "est marquee par",
      "est clairement",
      "souffre de",
      "revele que",
      "confirme que",
      "montre que",
      "traduit",
      "degradation",
      "defaillance",
      "impacte",
      "impactent",
      "conduit a",
      "conduisent a",
      "forte centralisation",
      "faiblesse des cadres",
      "cadres en difficulte",
      "grave",
    ];

    if (
      containsAny(anchor, forbiddenStrongPatterns) ||
      containsAny(hypothesis, forbiddenStrongPatterns) ||
      containsAny(risk, forbiddenStrongPatterns)
    ) {
      violations.push({
        criterion: "proof_discipline",
        severity: "high",
        message:
          "La formulation affirme trop fortement un constat ou un effet à partir d'un signal faible.",
      });
    }
  }

  const genericPatterns = [
    "pouvez-vous m'en dire plus",
    "comment expliquez-vous cette situation",
    "dans quelle mesure",
    "quels sont vos enjeux",
    "organisation a ameliorer",
    "manque de structuration",
    "quelles actions envisagez-vous",
  ];

  if (containsAny(question, genericPatterns)) {
    violations.push({
      criterion: "non_generic_style",
      severity: "medium",
      message:
        "La question est trop générique ou trop scolaire par rapport au niveau attendu.",
    });
  }

  const proofSeekingSignals = [
    "combien",
    "ordre de grandeur",
    "depuis quand",
    "sur quelle base",
    "qu'est-ce qui explique",
    "quel facteur",
    "quelle part",
    "quel poste",
    "quel client",
    "quel produit",
    "quel site",
    "quels arbitrages",
    "quelle decision",
    "en semaines",
    "en mois",
    "quel exemple",
    "quel cas recent",
    "pouvez-vous citer",
    "sur quel dossier",
    "sur quelle offre",
    "sur quel chantier",
  ];

  if (!containsAny(question, proofSeekingSignals)) {
    violations.push({
      criterion: "decision_utility",
      severity: "medium",
      message:
        "La question ne cherche pas assez clairement un chiffre, un mécanisme, une preuve ou un arbitrage réel.",
    });
  }

  const suggestivePatterns = [
    "pourquoi cela a-t-il echoue",
    "comment expliquez-vous cette defaillance",
    "pourquoi l'organisation est-elle insuffisante",
    "qu'est-ce qui a provoque cette mauvaise gestion",
  ];

  if (containsAny(question, suggestivePatterns)) {
    violations.push({
      criterion: "non_suggestive_wording",
      severity: "high",
      message:
        "La question embarque déjà une conclusion ou une causalité non encore établie.",
    });
  }

  if (anchor.length < 16) {
    violations.push({
      criterion: "factual_anchor",
      severity: "medium",
      message: "L'ancrage est trop court ou trop flou.",
    });
  }

  if (question.length < 24) {
    violations.push({
      criterion: "decision_utility",
      severity: "medium",
      message: "La question est trop courte pour être vraiment utile.",
    });
  }

  if (iteration === 1) {
    const earlyIterationSignals = [
      "exemple",
      "cas recent",
      "ordre de grandeur",
      "cite",
      "combien",
      "quel dossier",
      "quel chantier",
      "quelle offre",
      "quelle decision",
      "quels arbitrages",
    ];

    if (!containsAny(question, earlyIterationSignals)) {
      violations.push({
        criterion: "right_instruction_goal",
        severity: "medium",
        message:
          "En itération 1, la question doit prioritairement chercher un exemple concret, un ordre de grandeur ou un arbitrage réel.",
      });
    }
  }

  return violations;
}

function scoreFromViolations(violations: QuestionJudgmentViolation[]): number {
  let score = 100;

  for (const violation of violations) {
    if (violation.severity === "high") score -= 30;
    else if (violation.severity === "medium") score -= 15;
    else score -= 8;
  }

  return clampScore0to100(score);
}

function buildFallbackRewrite(input: QuestionJudgeInput): QuestionCandidate {
  const { fact } = input;

  const displayMode =
    fact.proof_level <= 2 ? "point_to_clarify" : inferDisplayModeFromFact(fact);

  const anchor =
    displayMode === "point_to_clarify"
      ? `La trame suggère un point à objectiver sur "${fact.theme}".`
      : `La trame suggère un enjeu sur "${fact.theme}", mais son ampleur reste à confirmer.`;

  const hypothesis =
    displayMode === "point_to_clarify"
      ? undefined
      : fact.prudent_hypothesis ||
        "Ce point mérite d’être objectivé avant toute conclusion plus ferme.";

  const managerialRisk =
    fact.managerial_risk ||
    "Sans qualification précise, le diagnostic risque de rester trop général ou de mal hiérarchiser les priorités.";

  const question = (() => {
    switch (fact.instruction_goal) {
      case "quantify":
        return `Pouvez-vous donner un ordre de grandeur récent permettant d’objectiver ce point sur "${fact.theme}" ?`;
      case "measure_impact":
        return `Pouvez-vous citer un cas récent et préciser l’impact concret de ce point sur la marge, le cash, la charge ou l’exécution ?`;
      case "explain_cause":
        return `Pouvez-vous citer un cas récent qui illustre ce point sur "${fact.theme}" et préciser le mécanisme concret en jeu ?`;
      case "test_arbitration":
        return `Pouvez-vous citer un cas récent où un défaut de cadrage, de coordination ou de décision sur "${fact.theme}" a eu un effet concret sur un dossier, une offre ou un chantier ?`;
      case "verify":
      default:
        return `Pouvez-vous citer un exemple récent, un fait précis ou un ordre de grandeur permettant d’objectiver ce point sur "${fact.theme}" ?`;
    }
  })();

  return {
    fact_id: fact.id,
    theme: fact.theme,
    display_mode: displayMode,
    anchor,
    hypothesis,
    managerial_risk: managerialRisk,
    question,
  };
}

async function llmJudgeCandidate(
  input: QuestionJudgeInput
): Promise<QuestionJudgment | null> {
  const prompt = `
Tu es un juge qualité spécialisé en diagnostic de redressement d’entreprise.

Tu n’écris pas un diagnostic complet.
Tu juges uniquement si une formulation de question est autorisée, crédible et utile.

Réponds STRICTEMENT en JSON :
{
  "decision": "accept|rewrite|reject",
  "score": 0,
  "strengths": ["string"],
  "violations": [
    {
      "criterion": "proof_discipline|factual_anchor|decision_utility|non_generic_style|non_suggestive_wording|right_instruction_goal",
      "severity": "low|medium|high",
      "message": "string"
    }
  ],
  "rewritten_candidate": {
    "fact_id": "string",
    "theme": "string",
    "display_mode": "point_to_clarify|prudent_observation|validated_finding",
    "anchor": "string",
    "hypothesis": "string",
    "managerial_risk": "string",
    "question": "string"
  }
}

Règles impératives :
- si le niveau de preuve est faible, interdire les formulations affirmatives fortes
- si proof_level <= 2, display_mode doit rester "point_to_clarify"
- interdire des formulations comme "X est en difficulté", "cela impacte", "cela conduit à" tant que la preuve est faible
- distinguer strictement fait, hypothèse prudente et constat validé
- une bonne question cherche soit :
  1. un ordre de grandeur
  2. une preuve concrète
  3. un mécanisme causal
  4. un arbitrage réel du dirigeant
- en itération 1, privilégier un exemple concret ou un arbitrage réel
- refuser les formulations scolaires, vagues, génériques ou suggestives
- ne jamais changer le thème
- ne jamais inventer de chiffre
- si tu réécris, produire une version plus crédible et plus utile
- score entre 0 et 100
- pas de markdown
- pas de texte hors JSON

Contexte :
dimension=${input.dimension}
iteration=${input.iteration}
mode=${input.mode}
theme=${input.fact.theme}
proof_level=${input.fact.proof_level}
allowed_statement_mode=${input.fact.allowed_statement_mode}
instruction_goal=${input.fact.instruction_goal}
evidence_kind=${input.fact.evidence_kind}

Fait source :
observed_element=${input.fact.observed_element}
source_excerpt=${input.fact.source_excerpt ?? ""}
prudent_hypothesis=${input.fact.prudent_hypothesis ?? ""}
managerial_risk=${input.fact.managerial_risk ?? ""}

Question candidate :
fact_id=${input.candidate.fact_id}
theme=${input.candidate.theme}
display_mode=${input.candidate.display_mode}
anchor=${input.candidate.anchor}
hypothesis=${input.candidate.hypothesis ?? ""}
managerial_risk=${input.candidate.managerial_risk ?? ""}
question=${input.candidate.question}

Thèmes autorisés :
${input.allowedThemes.join(" | ")}

Thèmes interdits :
${input.forbiddenThemes.join(" | ")}

Preuves attendues :
${input.evidenceExpectations.join(" | ")}

Risques de confusion :
${input.confusionRisks.join(" | ")}
`.trim();

  try {
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL_CHAT || "gpt-4o-mini",
      temperature: 0.05,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Tu es un juge qualité strict. Tu protèges la discipline de preuve, la crédibilité métier et la qualité des questions. Tu réponds uniquement en JSON.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);

    const decision =
      parsed?.decision === "accept" ||
      parsed?.decision === "rewrite" ||
      parsed?.decision === "reject"
        ? parsed.decision
        : "rewrite";

    const rewritten =
      parsed?.rewritten_candidate &&
      typeof parsed.rewritten_candidate === "object"
        ? {
            fact_id:
              String(parsed.rewritten_candidate.fact_id ?? "").trim() ||
              input.candidate.fact_id,
            theme:
              String(parsed.rewritten_candidate.theme ?? "").trim() ||
              input.candidate.theme,
            display_mode:
              parsed.rewritten_candidate.display_mode === "point_to_clarify" ||
              parsed.rewritten_candidate.display_mode === "prudent_observation" ||
              parsed.rewritten_candidate.display_mode === "validated_finding"
                ? parsed.rewritten_candidate.display_mode
                : input.candidate.display_mode,
            anchor:
              String(parsed.rewritten_candidate.anchor ?? "").trim() ||
              input.candidate.anchor,
            hypothesis:
              String(parsed.rewritten_candidate.hypothesis ?? "").trim() || undefined,
            managerial_risk:
              String(parsed.rewritten_candidate.managerial_risk ?? "").trim() ||
              input.candidate.managerial_risk,
            question:
              String(parsed.rewritten_candidate.question ?? "").trim() ||
              input.candidate.question,
          }
        : undefined;

    return {
      decision,
      score: clampScore0to100(parsed?.score ?? 0),
      strengths: Array.isArray(parsed?.strengths)
        ? parsed.strengths.map(String).filter(Boolean).slice(0, 5)
        : [],
      violations: Array.isArray(parsed?.violations)
        ? parsed.violations
            .map((v: any) => ({
              criterion: String(v?.criterion ?? "").trim(),
              severity: String(v?.severity ?? "").trim(),
              message: String(v?.message ?? "").trim(),
            }))
            .filter(
              (v: any) =>
                [
                  "proof_discipline",
                  "factual_anchor",
                  "decision_utility",
                  "non_generic_style",
                  "non_suggestive_wording",
                  "right_instruction_goal",
                ].includes(v.criterion) &&
                ["low", "medium", "high"].includes(v.severity) &&
                v.message
            )
            .slice(0, 8)
        : [],
      rewritten_candidate: rewritten,
    };
  } catch {
    return null;
  }
}

export async function judgeQuestionCandidate(
  input: QuestionJudgeInput
): Promise<QuestionJudgment> {
  const baseViolations = deterministicViolations(input);
  const baseScore = scoreFromViolations(baseViolations);

  if (baseScore >= 85) {
    return {
      decision: "accept",
      score: baseScore,
      strengths: [
        "La question reste compatible avec le niveau de preuve.",
        "L’ancrage est suffisamment relié au fait source.",
      ],
      violations: baseViolations,
    };
  }

  const llmResult = await llmJudgeCandidate(input);

  if (!llmResult) {
    const fallbackRewrite = buildFallbackRewrite(input);
    return {
      decision: baseScore >= 60 ? "rewrite" : "reject",
      score: baseScore,
      strengths: [],
      violations: baseViolations,
      rewritten_candidate: fallbackRewrite,
    };
  }

  const mergedViolations = [...baseViolations, ...llmResult.violations];
  const mergedScore = Math.min(
    llmResult.score || 0,
    scoreFromViolations(mergedViolations)
  );

  if (llmResult.decision === "accept" && mergedScore >= 85) {
    return {
      ...llmResult,
      score: mergedScore,
      violations: mergedViolations,
    };
  }

  if (llmResult.rewritten_candidate) {
    return {
      decision: mergedScore >= 55 ? "rewrite" : "reject",
      score: mergedScore,
      strengths: llmResult.strengths,
      violations: mergedViolations,
      rewritten_candidate: llmResult.rewritten_candidate,
    };
  }

  return {
    decision: mergedScore >= 55 ? "rewrite" : "reject",
    score: mergedScore,
    strengths: llmResult.strengths,
    violations: mergedViolations,
    rewritten_candidate: buildFallbackRewrite(input),
  };
}

export async function judgeAndNormalizeQuestionCandidate(
  input: QuestionJudgeInput
): Promise<{
  judgment: QuestionJudgment;
  finalCandidate: QuestionCandidate;
}> {
  const judgment = await judgeQuestionCandidate(input);

  const finalCandidate =
    judgment.decision === "accept"
      ? input.candidate
      : judgment.rewritten_candidate || buildFallbackRewrite(input);

  return {
    judgment,
    finalCandidate,
  };
}
