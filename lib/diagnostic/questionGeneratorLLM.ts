import OpenAI from "openai";

/*
 * questionGeneratorLLM.ts
 *
 * Génère des questions d’entretien à partir de faits diagnostiques enrichis.
 *
 * Objectif :
 * - utiliser les faits précis issus de la trame ;
 * - exploiter les extraits source, chiffres et questions suggérées ;
 * - éviter les questions génériques ;
 * - faire des itérations 2 et 3 de vraies questions de rebond.
 */

export interface FactSummary {
  id: string;
  theme: string;
  raw_signal: string;
  managerial_risk: string;
  recommended_entry_angle: string;

  diagnostic_statement?: string;
  source_excerpt?: string;
  numeric_values?: Record<string, number | string>;
  numeric_context?: string;
  suggested_questions?: string[];

  progress?: string;
  missing_angles?: string[];
  asked_angles?: string[];

  previous_questions?: string[];
  previous_answers?: string[];
  answer_summaries?: string[];
  validated_findings?: string[];
  open_hypotheses?: string[];
  contradictions?: string[];
  next_question_hints?: string[];
}

export interface GeneratedQuestion {
  fact_id: string;
  theme: string;
  question: string;
  intended_angle: string;
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const ALLOWED_ANGLES = [
  "example",
  "magnitude",
  "mechanism",
  "causality",
  "dependency",
  "arbitration",
  "formalization",
  "transition",
  "economics",
  "frequency",
  "feedback",
];

function normalizeQuestion(value: string) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function normalizeText(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAngle(value: string) {
  const x = normalizeText(value);

  if (ALLOWED_ANGLES.includes(x)) return x;

  if (x.includes("exemple") || x.includes("cas")) return "example";
  if (x.includes("ordre") || x.includes("quant") || x.includes("combien")) {
    return "magnitude";
  }
  if (x.includes("mecan") || x.includes("fonction")) return "mechanism";
  if (x.includes("cause") || x.includes("pourquoi")) return "causality";
  if (x.includes("depend")) return "dependency";
  if (x.includes("arbitr")) return "arbitration";
  if (x.includes("formal")) return "formalization";
  if (x.includes("transition") || x.includes("bascule")) return "transition";
  if (x.includes("econom") || x.includes("marge") || x.includes("rentabilite")) {
    return "economics";
  }
  if (x.includes("frequence") || x.includes("souvent")) return "frequency";
  if (x.includes("rex") || x.includes("retour")) return "feedback";

  return "mechanism";
}

function cleanArray(values: unknown[] | undefined, max = 6): string[] {
  if (!Array.isArray(values)) return [];

  const out: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const text = normalizeQuestion(String(value || ""));
    if (!text) continue;

    const key = normalizeText(text);
    if (!key || seen.has(key)) continue;

    seen.add(key);
    out.push(text);

    if (out.length >= max) break;
  }

  return out;
}

function cleanNumericValues(value: unknown): Record<string, number | string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

  const out: Record<string, number | string> = {};

  for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const cleanKey = String(key || "").trim();
    if (!cleanKey) continue;

    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      out[cleanKey] = rawValue;
      continue;
    }

    const cleanValue = String(rawValue ?? "").replace(/\s+/g, " ").trim();
    if (cleanValue) out[cleanKey] = cleanValue;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function numericValuesToText(values?: Record<string, number | string>) {
  if (!values || Object.keys(values).length === 0) return "";
  return Object.entries(values)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" | ");
}

function hasPreviousAnswers(fact: FactSummary) {
  return (
    cleanArray(fact.previous_answers, 1).length > 0 ||
    cleanArray(fact.answer_summaries, 1).length > 0 ||
    cleanArray(fact.validated_findings, 1).length > 0
  );
}

function isGenericQuestion(question: string) {
  const q = normalizeText(question);

  if (!q) return true;
  if (q.length < 25) return true;

  const forbidden = [
    "quel est aujourd hui le point le moins maitrise",
    "quel est le point le moins maitrise",
    "pouvez vous preciser ce point",
    "comment expliquez vous ce sujet",
    "que pouvez vous dire sur",
    "sur ce theme pouvez vous",
    "pouvez vous decrire concretement ce point",
  ];

  return forbidden.some((f) => q.includes(f));
}

function buildIterationInstruction(iteration: number) {
  if (iteration <= 1) {
    return `
Itération 1 :
- partir de la trame ;
- poser une question directement ancrée dans un fait précis ;
- si un chiffre existe, l'utiliser explicitement dans la question ;
- éviter toute question générique de découverte.
`.trim();
  }

  if (iteration === 2) {
    return `
Itération 2 :
- utiliser prioritairement les réponses déjà données ;
- ne pas repartir du signal initial comme si rien n'avait été dit ;
- approfondir la cause, le mécanisme, la dépendance, l'arbitrage ou l'ordre de grandeur manquant ;
- la question doit être une vraie question de rebond.
`.trim();
  }

  return `
Itération 3 :
- consolider et tester la robustesse du diagnostic ;
- ne pas poser une question de découverte générale ;
- utiliser les réponses précédentes pour aller vers l'arbitrage, l'impact, la condition de maîtrise ou la correction possible ;
- rechercher ce qui permet de verrouiller ou d'infirmer le constat final.
`.trim();
}

function buildFactSummariesForPrompt(facts: FactSummary[]) {
  return facts.map((f) => {
    const numericValues = cleanNumericValues(f.numeric_values);
    const numericContext =
      normalizeQuestion(f.numeric_context || "") ||
      numericValuesToText(numericValues);

    return {
      fact_id: f.id,
      theme: f.theme,
      diagnostic_statement:
        normalizeQuestion(f.diagnostic_statement || "") ||
        normalizeQuestion(f.raw_signal || ""),
      raw_signal: normalizeQuestion(f.raw_signal || ""),
      source_excerpt: normalizeQuestion(f.source_excerpt || ""),
      numeric_values: numericValues ?? {},
      numeric_context: numericContext,
      suggested_questions: cleanArray(f.suggested_questions, 5),
      managerial_risk: normalizeQuestion(f.managerial_risk || ""),
      recommended_entry_angle: normalizeAngle(f.recommended_entry_angle || ""),
      progress: f.progress ?? null,
      missing_angles: cleanArray(f.missing_angles, 8).map(normalizeAngle),
      asked_angles: cleanArray(f.asked_angles, 8).map(normalizeAngle),
      previous_questions: cleanArray(f.previous_questions, 6),
      previous_answers: cleanArray(f.previous_answers, 6),
      answer_summaries: cleanArray(f.answer_summaries, 6),
      validated_findings: cleanArray(f.validated_findings, 6),
      open_hypotheses: cleanArray(f.open_hypotheses, 6),
      contradictions: cleanArray(f.contradictions, 6),
      next_question_hints: cleanArray(f.next_question_hints, 6),
      has_previous_answers: hasPreviousAnswers(f),
    };
  });
}

function fallbackQuestionForFact(
  fact: FactSummary,
  iteration: number
): GeneratedQuestion {
  const numericValues = cleanNumericValues(fact.numeric_values);
  const numericText =
    normalizeQuestion(fact.numeric_context || "") || numericValuesToText(numericValues);

  const statement =
    normalizeQuestion(fact.diagnostic_statement || "") ||
    normalizeQuestion(fact.raw_signal || "") ||
    normalizeQuestion(fact.source_excerpt || "");

  const previous =
    cleanArray(fact.answer_summaries, 1)[0] ||
    cleanArray(fact.previous_answers, 1)[0] ||
    cleanArray(fact.validated_findings, 1)[0];

  let question: string;
  let angle: string;

  if (iteration <= 1 && numericText) {
    question = `Sur ce point chiffré (${numericText}), qu'est-ce qui explique concrètement la situation suivante : ${statement} ?`;
    angle = "causality";
  } else if (iteration <= 1) {
    question = `Concrètement, comment se manifeste aujourd'hui ce point dans le fonctionnement réel : ${statement} ?`;
    angle = normalizeAngle(fact.recommended_entry_angle || "mechanism");
  } else if (iteration === 2 && previous) {
    question = `Vous avez indiqué "${previous}". Qu'est-ce qui explique principalement cette situation par rapport au point suivant : ${statement} ?`;
    angle = "causality";
  } else if (iteration === 2) {
    question = `Qu'est-ce qui explique principalement ce point et qui arbitre aujourd'hui lorsqu'il se produit : ${statement} ?`;
    angle = "arbitration";
  } else if (previous) {
    question = `À partir de votre réponse "${previous}", quel arbitrage concret permettrait de sécuriser durablement ce point : ${statement} ?`;
    angle = "arbitration";
  } else {
    question = `Quel changement concret permettrait de sécuriser durablement ce point : ${statement} ?`;
    angle = "transition";
  }

  return {
    fact_id: fact.id,
    theme: fact.theme,
    question: normalizeQuestion(question),
    intended_angle: angle,
  };
}

function questionHasUsefulAnchor(question: string, fact: FactSummary) {
  const q = normalizeText(question);

  if (!q || q.length < 25) return false;

  const numericValues = cleanNumericValues(fact.numeric_values);
  const numericText = normalizeText(
    normalizeQuestion(fact.numeric_context || "") || numericValuesToText(numericValues)
  );

  if (numericText) {
    const numericTokens = numericText
      .split(" ")
      .filter((token) => token.length >= 2 || /\d/.test(token));

    if (numericTokens.some((token) => q.includes(token))) return true;
  }

  const statement = normalizeText(
    normalizeQuestion(fact.diagnostic_statement || "") ||
      normalizeQuestion(fact.raw_signal || "")
  );

  const source = normalizeText(fact.source_excerpt || "");

  const previous = normalizeText(
    [
      ...(fact.previous_answers || []),
      ...(fact.answer_summaries || []),
      ...(fact.validated_findings || []),
    ].join(" ")
  );

  const tokens = [...statement.split(" "), ...source.split(" "), ...previous.split(" ")]
    .filter((token) => token.length >= 4)
    .slice(0, 40);

  let hits = 0;
  for (const token of tokens) {
    if (q.includes(token)) hits += 1;
  }

  return hits >= 2;
}

export async function generateQuestionBatch(params: {
  facts: FactSummary[];
  dimension: number;
  iteration: number;
}): Promise<GeneratedQuestion[]> {
  const { facts, dimension, iteration } = params;

  if (facts.length === 0) return [];

  const factSummaries = buildFactSummariesForPrompt(facts);

  const prompt = `
Tu es un consultant senior en diagnostic d'entreprise et redressement de PME.

OBJECTIF MAJEUR :
Générer des questions d'entretien utiles, précises et ancrées.
Les questions doivent exploiter les faits extraits de la trame, les chiffres, les extraits source et la mémoire des réponses précédentes.

${buildIterationInstruction(iteration)}

Pour chaque fait, tu reçois :
- diagnostic_statement : le constat précis ;
- source_excerpt : l'extrait de trame qui justifie le constat ;
- numeric_values / numeric_context : les chiffres éventuels ;
- suggested_questions : questions suggérées par l'extracteur ;
- previous_questions : questions déjà posées ;
- previous_answers / answer_summaries : réponses déjà obtenues ;
- validated_findings : constats déjà validés ;
- open_hypotheses : hypothèses encore ouvertes ;
- asked_angles et missing_angles.

RÈGLES ABSOLUES :
1. Ne repose jamais une question déjà posée, même reformulée.
2. Ne produis jamais une question générique de type "quel est le point le moins maîtrisé ?".
3. La question doit mentionner ou exploiter un élément précis du fait : chiffre, extrait source, mécanisme, rôle, client, outil, retard, marge, charge, responsable, rituel ou réponse précédente.
4. Si numeric_values ou numeric_context existent, la question doit si possible citer le chiffre ou demander son explication.
5. Si suggested_questions existe et qu'elle est bonne, tu peux l'utiliser ou l'améliorer.
6. Si previous_answers ou answer_summaries existent, la question doit rebondir dessus.
7. En itération 2, approfondis cause, mécanisme, dépendance ou arbitrage.
8. En itération 3, teste impact, robustesse, arbitrage final, correction ou condition de maîtrise.
9. Une question = une seule phrase.
10. Ne produis aucune phrase tronquée.
11. Le champ intended_angle doit être exactement l'un de ces angles :
${ALLOWED_ANGLES.join(", ")}.

Retourne STRICTEMENT ce JSON :
{
  "questions": [
    {
      "fact_id": "string",
      "question": "string",
      "intended_angle": "string"
    }
  ]
}

FACTS:
${JSON.stringify(factSummaries, null, 2)}

Dimension: ${dimension}
Iteration: ${iteration}
`.trim();

  try {
    const resp = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL_CHAT || "gpt-4o-mini",
      temperature: 0.03,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Consultant senior en retournement de PME. Tu génères des questions d'entretien précises, ancrées, non répétitives. JSON uniquement.",
        },
        { role: "user", content: prompt },
      ],
    });

    const raw = resp.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];

    const generated = questions
      .map((q: any) => {
        const factId = String(q?.fact_id ?? "").trim();
        const fact = facts.find((f) => f.id === factId);

        return {
          fact_id: factId,
          theme: fact?.theme ?? "",
          question: normalizeQuestion(String(q?.question ?? "")),
          intended_angle: normalizeAngle(String(q?.intended_angle ?? "")),
        } as GeneratedQuestion;
      })
      .filter((q: GeneratedQuestion) => q.fact_id && q.question);

    const byFact = new Map(facts.map((fact) => [fact.id, fact]));
    const finalQuestions: GeneratedQuestion[] = [];
    const seen = new Set<string>();

    for (const question of generated) {
      const fact = byFact.get(question.fact_id);
      if (!fact) continue;

      const normalized = normalizeText(question.question);
      if (!normalized || seen.has(normalized)) continue;
      if (isGenericQuestion(question.question)) continue;
      if (!questionHasUsefulAnchor(question.question, fact)) continue;

      seen.add(normalized);
      finalQuestions.push(question);
    }

    for (const fact of facts) {
      if (finalQuestions.some((q) => q.fact_id === fact.id)) continue;

      const fallback = fallbackQuestionForFact(fact, iteration);
      const normalized = normalizeText(fallback.question);

      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        finalQuestions.push(fallback);
      }
    }

    return finalQuestions;
  } catch {
    return facts.map((fact) => fallbackQuestionForFact(fact, iteration));
  }
}