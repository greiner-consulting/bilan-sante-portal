import OpenAI from "openai";

/*
 * questionGeneratorLLM.ts
 *
 * Génère des questions d’entretien à partir de signaux diagnostiques enrichis.
 * Le LLM reçoit la mémoire des questions/réponses déjà posées sur chaque fait,
 * afin que les itérations 2 et 3 soient de vraies questions de rebond.
 */

export interface FactSummary {
  id: string;
  theme: string;
  raw_signal: string;
  managerial_risk: string;
  recommended_entry_angle: string;

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

function normalizeQuestion(value: string) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeAngle(value: string) {
  const x = String(value || "").trim().toLowerCase();
  const allowed = [
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
  if (allowed.includes(x)) return x;
  if (x.includes("exemple") || x.includes("cas")) return "example";
  if (x.includes("ordre") || x.includes("quant") || x.includes("combien")) return "magnitude";
  if (x.includes("mécan") || x.includes("mecan") || x.includes("fonction")) return "mechanism";
  if (x.includes("cause") || x.includes("pourquoi")) return "causality";
  if (x.includes("dépend") || x.includes("depend")) return "dependency";
  if (x.includes("arbitr")) return "arbitration";
  if (x.includes("formal")) return "formalization";
  if (x.includes("transition")) return "transition";
  if (x.includes("économ") || x.includes("econom") || x.includes("marge")) return "economics";
  if (x.includes("fréquence") || x.includes("frequence")) return "frequency";
  if (x.includes("rex") || x.includes("retour")) return "feedback";
  return "mechanism";
}

function buildIterationInstruction(iteration: number) {
  if (iteration <= 1) {
    return `Itération 1 : partir de la trame, clarifier les signaux initiaux et éviter les questions déjà traitées.`;
  }
  if (iteration === 2) {
    return `Itération 2 : utiliser prioritairement les réponses déjà données ; chercher la cause, le mécanisme, l'arbitrage ou l'ordre de grandeur qui manque ; formuler une question de rebond reliée à ce que le dirigeant a déjà dit.`;
  }
  return `Itération 3 : consolider et tester la robustesse du diagnostic ; ne pas poser une question de découverte générale ; rebondir sur les réponses précédentes ; rechercher la conséquence économique, la condition de maîtrise, la fréquence, la dépendance ou l'arbitrage final manquant.`;
}

export async function generateQuestionBatch(params: {
  facts: FactSummary[];
  dimension: number;
  iteration: number;
}): Promise<GeneratedQuestion[]> {
  const { facts, dimension, iteration } = params;
  if (facts.length === 0) return [];

  const factSummaries = facts.map((f) => ({
    fact_id: f.id,
    theme: f.theme,
    raw_signal: f.raw_signal,
    managerial_risk: f.managerial_risk,
    recommended_entry_angle: f.recommended_entry_angle,
    progress: f.progress ?? null,
    missing_angles: Array.isArray(f.missing_angles) ? f.missing_angles : [],
    asked_angles: Array.isArray(f.asked_angles) ? f.asked_angles : [],
    previous_questions: Array.isArray(f.previous_questions) ? f.previous_questions.slice(-5) : [],
    previous_answers: Array.isArray(f.previous_answers) ? f.previous_answers.slice(-5) : [],
    answer_summaries: Array.isArray(f.answer_summaries) ? f.answer_summaries.slice(-5) : [],
    validated_findings: Array.isArray(f.validated_findings) ? f.validated_findings.slice(-5) : [],
    open_hypotheses: Array.isArray(f.open_hypotheses) ? f.open_hypotheses.slice(-5) : [],
    contradictions: Array.isArray(f.contradictions) ? f.contradictions.slice(-5) : [],
    next_question_hints: Array.isArray(f.next_question_hints) ? f.next_question_hints.slice(-5) : [],
  }));

  const prompt = `
Tu es un consultant senior en diagnostic d'entreprise.

OBJECTIF MAJEUR : les itérations 2 et 3 doivent exploiter les réponses précédentes. Tu ne dois jamais te contenter de reformuler le signal initial si des réponses dirigeant existent.

${buildIterationInstruction(iteration)}

Pour chaque fait, tu reçois le signal initial, le risque, les questions déjà posées, les réponses déjà obtenues, les résumés, les constats validés, les hypothèses ouvertes, les angles déjà demandés et les angles manquants.

RÈGLES ABSOLUES :
1. Ne repose jamais une question déjà posée, même reformulée.
2. Si previous_answers ou answer_summaries existent, la nouvelle question doit s'y référer implicitement ou explicitement.
3. En itération 2, approfondis la cause, le mécanisme ou l'arbitrage.
4. En itération 3, teste la conséquence, la condition de maîtrise, l'ordre de grandeur, ou la robustesse du constat final.
5. N'utilise jamais de fragments numériques incompréhensibles issus de la trame.
6. Ne demande pas "quel est le point le moins maîtrisé ?".
7. Une question = une seule phrase.
8. Le champ intended_angle doit être : example, magnitude, mechanism, causality, dependency, arbitration, formalization, transition, economics, frequency ou feedback.

Retourne STRICTEMENT ce JSON :
{"questions":[{"fact_id":"string","question":"string","intended_angle":"string"}]}

FACTS:
${JSON.stringify(factSummaries, null, 2)}

Dimension: ${dimension}
Iteration: ${iteration}
`.trim();

  try {
    const resp = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL_CHAT || "gpt-4o-mini",
      temperature: 0.05,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Consultant senior en retournement de PME. Génération de questions de rebond, uniquement en JSON." },
        { role: "user", content: prompt },
      ],
    });
    const raw = resp.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
    return questions
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
      .filter((q) => q.fact_id && q.question);
  } catch {
    return [];
  }
}
