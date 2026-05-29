import OpenAI from "openai";

/*
 * questionGeneratorLLM.ts
 *
 * Génère des questions d’entretien à partir de faits diagnostiques enrichis.
 *
 * Principe :
 * - le LLM doit raisonner comme un consultant senior ;
 * - il doit formuler la meilleure question d’entretien, pas appliquer un gabarit ;
 * - les garde-fous restent minimaux pour éviter les questions vides, génériques
 *   ou manifestement hors sujet ;
 * - les fallbacks ne servent qu’en secours.
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
  if (
    x.includes("ordre") ||
    x.includes("quant") ||
    x.includes("combien") ||
    x.includes("montant") ||
    x.includes("volume")
  ) {
    return "magnitude";
  }
  if (x.includes("mecan") || x.includes("fonction") || x.includes("process")) {
    return "mechanism";
  }
  if (x.includes("cause") || x.includes("pourquoi") || x.includes("explique")) {
    return "causality";
  }
  if (x.includes("depend")) return "dependency";
  if (x.includes("arbitr") || x.includes("decision")) return "arbitration";
  if (x.includes("formal") || x.includes("regle") || x.includes("procedure")) {
    return "formalization";
  }
  if (x.includes("transition") || x.includes("bascule") || x.includes("changement")) {
    return "transition";
  }
  if (x.includes("econom") || x.includes("marge") || x.includes("rentabilite")) {
    return "economics";
  }
  if (x.includes("frequence") || x.includes("rythme") || x.includes("souvent")) {
    return "frequency";
  }
  if (x.includes("rex") || x.includes("retour")) return "feedback";

  return "mechanism";
}

function cleanArray(values: unknown[] | undefined, max = 8): string[] {
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

function statementForFact(fact: FactSummary) {
  return (
    normalizeQuestion(fact.diagnostic_statement || "") ||
    normalizeQuestion(fact.raw_signal || "") ||
    normalizeQuestion(fact.source_excerpt || "") ||
    normalizeQuestion(fact.theme || "")
  );
}

function numericTextForFact(fact: FactSummary) {
  return (
    normalizeQuestion(fact.numeric_context || "") ||
    numericValuesToText(cleanNumericValues(fact.numeric_values))
  );
}

function previousMemoryForFact(fact: FactSummary) {
  return [
    ...cleanArray(fact.previous_answers, 5),
    ...cleanArray(fact.answer_summaries, 5),
    ...cleanArray(fact.validated_findings, 5),
    ...cleanArray(fact.open_hypotheses, 5),
  ];
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
    "pouvez vous m en dire plus",
    "qu en pensez vous",
    "qu est ce qui explique principalement ce point qui arbitre lorsqu il se produit",
    "qu est ce qui explique principalement ce point",
  ];

  return forbidden.some((f) => q.includes(f));
}

function questionTooMechanical(question: string) {
  const q = normalizeText(question);

  const badPatterns = [
    "qui arbitre lorsqu il se produit et quelle regle permettrait",
    "qui arbitre lorsqu il se produit",
    "quelle regle permettrait d eviter qu il reste insuffisamment pilote",
    "sur ce point qui fixe concretement les priorites qui arbitre",
    "quel changement concret porte par quel responsable et suivi avec quel indicateur",
  ];

  return badPatterns.some((pattern) => q.includes(pattern));
}

function questionHasSomeAnchor(question: string, fact: FactSummary) {
  const q = normalizeText(question);
  if (!q || q.length < 25) return false;

  const numeric = normalizeText(numericTextForFact(fact));
  if (numeric) {
    const numericTokens = numeric
      .split(" ")
      .filter((token) => token.length >= 2 || /\d/.test(token));

    if (numericTokens.some((token) => q.includes(token))) return true;
  }

  const source = normalizeText(
    [
      fact.theme,
      fact.diagnostic_statement,
      fact.raw_signal,
      fact.source_excerpt,
      fact.managerial_risk,
      ...previousMemoryForFact(fact),
    ].join(" ")
  );

  const tokens = source
    .split(" ")
    .filter((token) => token.length >= 4)
    .slice(0, 60);

  let hits = 0;
  for (const token of tokens) {
    if (q.includes(token)) hits += 1;
  }

  return hits >= 1;
}

function inferSignalFamily(fact: FactSummary) {
  const text = normalizeText(
    [
      fact.theme,
      fact.raw_signal,
      fact.diagnostic_statement,
      fact.source_excerpt,
      fact.managerial_risk,
      numericTextForFact(fact),
    ].join(" ")
  );

  if (
    text.includes("tf1") ||
    text.includes("zero accident") ||
    text.includes("0 accident") ||
    text.includes("absence d accidents") ||
    text.includes("bonne pratique") ||
    text.includes("signal positif") ||
    text.includes("superieure au budget") ||
    text.includes("maitrise")
  ) {
    return "signal positif / maintien de la performance";
  }

  if (
    text.includes("marge") ||
    text.includes("ebitda") ||
    text.includes("rentabilite") ||
    text.includes("cout") ||
    text.includes("impute") ||
    text.includes("facturation") ||
    text.includes("ecart") ||
    text.includes("budget") ||
    text.includes("taux horaire")
  ) {
    return "économie / marge / fiabilité financière";
  }

  if (
    text.includes("client") ||
    text.includes("top 10") ||
    text.includes("pipeline") ||
    text.includes("pipe") ||
    text.includes("conversion") ||
    text.includes("commercial") ||
    text.includes("devis") ||
    text.includes("offre")
  ) {
    return "commercial / clients / pipeline";
  }

  if (
    text.includes("dependance") ||
    text.includes("responsabilite") ||
    text.includes("relais") ||
    text.includes("encadrement") ||
    text.includes("collaborateur") ||
    text.includes("rattache") ||
    text.includes("direction technique") ||
    text.includes("qhse") ||
    text.includes("qse")
  ) {
    return "organisation / responsabilités / dépendance humaine";
  }

  if (
    text.includes("planning") ||
    text.includes("charge") ||
    text.includes("capacite") ||
    text.includes("chantier") ||
    text.includes("production") ||
    text.includes("execution") ||
    text.includes("delai") ||
    text.includes("retard") ||
    text.includes("heures") ||
    text.includes("ressources")
  ) {
    return "exécution / planning / ressources";
  }

  return "diagnostic général";
}

function chooseFallbackAngle(fact: FactSummary, iteration: number) {
  const missingAngles = cleanArray(fact.missing_angles, 8).map(normalizeAngle);
  const askedAngles = new Set(cleanArray(fact.asked_angles, 8).map(normalizeAngle));
  const firstMissing = missingAngles.find((angle) => !askedAngles.has(angle));

  if (firstMissing) return firstMissing;

  const family = inferSignalFamily(fact);

  if (family.includes("positif")) return iteration <= 1 ? "mechanism" : "feedback";
  if (family.includes("économie")) return iteration <= 1 ? "magnitude" : "economics";
  if (family.includes("commercial")) return iteration <= 1 ? "mechanism" : "arbitration";
  if (family.includes("responsabilités")) return iteration <= 1 ? "dependency" : "arbitration";
  if (family.includes("exécution")) return iteration <= 1 ? "mechanism" : "transition";

  if (iteration <= 1) {
    if (numericTextForFact(fact)) return "magnitude";
    return normalizeAngle(fact.recommended_entry_angle || "mechanism");
  }

  if (iteration === 2) return "causality";
  return "transition";
}

function fallbackQuestionForFact(fact: FactSummary, iteration: number): GeneratedQuestion {
  const statement = statementForFact(fact);
  const numeric = numericTextForFact(fact);
  const previous = previousMemoryForFact(fact)[0];
  const family = inferSignalFamily(fact);

  let question: string;

  if (previous && iteration >= 2) {
    question = `Vous avez indiqué "${previous}". Quelle question faudrait-il encore clarifier pour confirmer ou infirmer le diagnostic sur ce point : ${statement} ?`;
  } else if (family.includes("positif")) {
    question = `Ce point semble positif : qu’est-ce qui permet aujourd’hui de maintenir ce niveau, et quel signal faible vous alerterait sur une dégradation possible ?`;
  } else if (family.includes("économie") && numeric) {
    question = `Sur ce point chiffré (${numeric}), quelle lecture faites-vous de l’écart, et quelle décision opérationnelle permettrait de le maîtriser ?`;
  } else if (family.includes("commercial") && numeric) {
    question = `Sur ce point commercial (${numeric}), comment qualifiez-vous la solidité des opportunités ou clients concernés, et quel risque principal voyez-vous ?`;
  } else if (family.includes("responsabilités")) {
    question = `Sur ce point d’organisation, qu’est-ce qui permet de savoir que la responsabilité est réellement portée au bon niveau, et où voyez-vous le risque de fragilité ?`;
  } else if (family.includes("exécution")) {
    question = `Sur ce point opérationnel, comment l’écart est-il détecté sur le terrain, et qu’est-ce qui permettrait de le traiter plus tôt ?`;
  } else if (numeric) {
    question = `Sur ce point chiffré (${numeric}), qu’est-ce qui vous paraît le plus important à comprendre pour établir le bon diagnostic ?`;
  } else {
    question = `Sur ce point précis, qu’est-ce qui vous paraît le plus important à comprendre pour établir le bon diagnostic : ${statement} ?`;
  }

  return {
    fact_id: fact.id,
    theme: fact.theme,
    question: normalizeQuestion(question),
    intended_angle: chooseFallbackAngle(fact, iteration),
  };
}

function buildIterationInstruction(iteration: number) {
  if (iteration <= 1) {
    return `
Itération 1 :
- ouvrir le sujet avec une question précise et naturelle ;
- exploiter la trame, les chiffres et l’extrait source ;
- ne pas poser une question générale ;
- la question doit aider le dirigeant à expliciter le fonctionnement réel, pas seulement confirmer le constat.
`.trim();
  }

  if (iteration === 2) {
    return `
Itération 2 :
- rebondir sur la matière déjà obtenue ;
- chercher la cause, le mécanisme, l’arbitrage, la fragilité ou la condition de maîtrise ;
- ne pas répéter la question d’itération 1 ;
- ne pas appliquer de gabarit automatique.
`.trim();
  }

  return `
Itération 3 :
- consolider le diagnostic ;
- tester la robustesse de ce qui a été dit ;
- faire émerger la conséquence, la priorité d’action, l’indicateur ou la condition de réussite ;
- préparer un objectif actionnable, sans poser une question de découverte générale.
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
      signal_family: inferSignalFamily(f),
      diagnostic_statement:
        normalizeQuestion(f.diagnostic_statement || "") ||
        normalizeQuestion(f.raw_signal || ""),
      raw_signal: normalizeQuestion(f.raw_signal || ""),
      source_excerpt: normalizeQuestion(f.source_excerpt || ""),
      numeric_values: numericValues ?? {},
      numeric_context: numericContext,
      managerial_risk: normalizeQuestion(f.managerial_risk || ""),
      suggested_questions: cleanArray(f.suggested_questions, 5),
      recommended_entry_angle: normalizeAngle(f.recommended_entry_angle || ""),
      progress: f.progress ?? null,
      missing_angles: cleanArray(f.missing_angles, 8).map(normalizeAngle),
      asked_angles: cleanArray(f.asked_angles, 8).map(normalizeAngle),
      previous_questions: cleanArray(f.previous_questions, 8),
      previous_answers: cleanArray(f.previous_answers, 8),
      answer_summaries: cleanArray(f.answer_summaries, 8),
      validated_findings: cleanArray(f.validated_findings, 8),
      open_hypotheses: cleanArray(f.open_hypotheses, 8),
      contradictions: cleanArray(f.contradictions, 6),
      next_question_hints: cleanArray(f.next_question_hints, 6),
    };
  });
}

function validateGeneratedQuestion(
  question: GeneratedQuestion,
  fact: FactSummary,
  iteration: number
): GeneratedQuestion {
  const text = normalizeQuestion(question.question);

  if (
    !text ||
    isGenericQuestion(text) ||
    questionTooMechanical(text) ||
    !questionHasSomeAnchor(text, fact)
  ) {
    return fallbackQuestionForFact(fact, iteration);
  }

  return {
    ...question,
    question: text,
    intended_angle: normalizeAngle(question.intended_angle),
  };
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
Tu es un consultant senior en diagnostic d'entreprise, redressement de PME et performance opérationnelle.

Ta mission :
formuler la meilleure question d’entretien possible pour chaque fait fourni.

Tu dois raisonner librement comme un consultant expérimenté.
Ne transforme pas les règles en gabarit.
Ne colle pas automatiquement "qui arbitre", "quelle règle" ou "quel indicateur" dans chaque question.
Utilise ces notions seulement quand elles sont réellement pertinentes.

${buildIterationInstruction(iteration)}

Ce que doit faire une bonne question :
- être spécifique au fait ;
- être naturelle dans un entretien avec un dirigeant ;
- exploiter si possible un chiffre, une personne, un client, un écart, un rôle, un processus ou une réponse précédente ;
- faire avancer le diagnostic ;
- éviter de simplement reformuler le constat ;
- ne poser qu’une seule vraie question, même si elle peut comporter deux éléments liés ;
- être courte à moyenne, pas une phrase lourde.

Ce que tu dois éviter :
- question générique ;
- question scolaire ;
- question mécanique ;
- question qui juxtapose "cause + arbitrage + règle + indicateur" sans logique ;
- question déjà posée ;
- question trop longue ;
- question qui ignore les réponses précédentes en itération 2 ou 3.

Orientation par itération :
- Itération 1 : comprendre le fonctionnement réel derrière le fait.
- Itération 2 : approfondir ce que les réponses ont révélé.
- Itération 3 : consolider la conséquence, la priorité d’action ou la condition de maîtrise.

Le champ intended_angle doit être exactement l'un de ces angles :
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
      temperature: 0.35,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Tu es un consultant senior exigeant. Tu produis des questions d'entretien précises, naturelles, ancrées, non mécaniques. JSON uniquement.",
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

      const checked = validateGeneratedQuestion(question, fact, iteration);
      const normalized = normalizeText(checked.question);

      if (!normalized || seen.has(normalized)) continue;

      seen.add(normalized);
      finalQuestions.push(checked);
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