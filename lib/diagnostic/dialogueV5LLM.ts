import OpenAI from "openai";

export type DialogueArea =
  | "context"
  | "rh"
  | "commercial"
  | "pricing"
  | "execution";

export type DiagnosticHypothesis = {
  id: string;
  statement: string;
  evidence: string[];
  confidence: "low" | "medium" | "high";
  potential_impact: string;
  status: "open" | "supported" | "weakened" | "confirmed" | "rejected";
};

export type DiagnosticAnalysis = {
  executive_reading: string;
  established_facts: string[];
  key_numbers: string[];
  anomalies: string[];
  contradictions: string[];
  hypotheses: DiagnosticHypothesis[];
  stakes: string[];
  unresolved_points: string[];
  cross_domain_links: string[];
};

export type DiagnosticSwot = {
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  threats: string[];
};

export type DialogueQuestion = {
  fact_id: string;
  theme: string;
  constat: string;
  risque_managerial: string;
  question: string;
  mandatory_passage_id?: string;
  tested_hypothesis_id?: string;
  information_sought?: string;
  decision_value?: string;
};

export type DialogueQa = {
  iteration: number;
  question: DialogueQuestion;
  answer: string;
};

export type DialogueAreaMaterial = {
  intake_answer: string;
  qa: DialogueQa[];
  analyses: Record<string, DiagnosticAnalysis>;
  syntheses: Record<string, string>;
  final_analysis?: DiagnosticAnalysis | null;
  final_synthesis?: string;
  swot?: DiagnosticSwot | null;
  validation_feedback?: string[];
  validated?: boolean;
};

export type CrossDomainMemory = {
  area: DialogueArea;
  label: string;
  synthesis: string;
  analysis?: DiagnosticAnalysis | null;
};

type MandatoryPassage = {
  id: string;
  label: string;
  instruction: string;
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const diagnosticModel =
  process.env.OPENAI_MODEL_DIAGNOSTIC ||
  process.env.OPENAI_MODEL_CHAT ||
  "gpt-4o";

export const AREA_ORDER: DialogueArea[] = [
  "context",
  "rh",
  "commercial",
  "pricing",
  "execution",
];

export const AREA_LABELS: Record<DialogueArea, string> = {
  context: "Contexte — Histoire & résultats",
  rh: "Organisation & RH",
  commercial: "Commercial & Marchés",
  pricing: "Cycle de vente & Prix",
  execution: "Exécution & Performance opérationnelle",
};

export function maxIterationsForArea(area: DialogueArea) {
  return area === "context" ? 1 : 3;
}

const MANDATORY_PASSAGES: Record<DialogueArea, MandatoryPassage[]> = {
  context: [
    {
      id: "history_perception",
      label: "Perception du dirigeant",
      instruction:
        "Faire exprimer l'impression personnelle du dirigeant sur la période : ce qui l'a surpris, préoccupé ou marqué, au-delà de la chronologie factuelle.",
    },
    {
      id: "history_turning_points",
      label: "Moments de rupture",
      instruction:
        "Identifier les événements ou ruptures qui ont réellement changé la trajectoire de l'entreprise et comprendre pourquoi ils ont eu cet effet.",
    },
    {
      id: "history_decisions",
      label: "Décisions et réactions",
      instruction:
        "Comprendre les décisions prises face aux difficultés ou opportunités, ce qui a fonctionné ou non, et ce que le dirigeant en retient.",
    },
    {
      id: "history_current_reading",
      label: "Lecture actuelle et héritage",
      instruction:
        "Faire préciser ce qui, de cette histoire, continue aujourd'hui à peser positivement ou négativement sur l'organisation et la performance.",
    },
  ],
  rh: [
    {
      id: "rh_management_team",
      label: "Équipe d'encadrement",
      instruction:
        "Obtenir une vision concrète de l'équipe d'encadrement, de ses rôles, points forts, points faibles et fragilités. Si ces informations ne sont pas déjà données, elles doivent obligatoirement être demandées.",
    },
    {
      id: "rh_skills_training",
      label: "Compétences et formation",
      instruction:
        "Comprendre comment les compétences sont identifiées, entretenues et développées : formation, tutorat, mobilité, succession, montée en compétence et gestion des écarts.",
    },
    {
      id: "rh_mindset_social",
      label: "État d'esprit et climat social",
      instruction:
        "Explorer l'état d'esprit des équipes, l'engagement, le climat social, les tensions éventuelles, la qualité du dialogue et les signaux faibles perçus par le dirigeant.",
    },
    {
      id: "rh_recruitment_management",
      label: "Recrutement et gestion RH",
      instruction:
        "Comprendre les éventuelles difficultés de recrutement et de fidélisation, ainsi que la manière dont les sujets RH sont réellement pilotés au quotidien.",
    },
  ],
  commercial: [
    {
      id: "strategy_axes",
      label: "Axes de développement",
      instruction:
        "Faire expliciter les axes de développement s'ils ne sont pas décrits. S'ils le sont déjà, vérifier qu'ils sont réellement hiérarchisés et compris.",
    },
    {
      id: "strategy_motivation",
      label: "Motivations et choix de marché",
      instruction:
        "Comprendre pourquoi ces axes ont été choisis : attractivité du marché, clients, besoins, position concurrentielle, expérience ou opportunité.",
    },
    {
      id: "strategy_strengths_promise",
      label: "Points forts et promesse commerciale",
      instruction:
        "Faire formuler les avantages distinctifs de l'entreprise et la promesse commerciale associée aux axes retenus : pourquoi un client choisirait cette entreprise plutôt qu'une autre.",
    },
    {
      id: "strategy_reality_check",
      label: "Stratégie construite ou intention",
      instruction:
        "Tester si la stratégie est réellement construite : choix assumés, moyens, compétences, responsabilités, actions engagées et cohérence avec la réalité du portefeuille ; distinguer une stratégie d'un souhait ou d'un rêve exprimé à voix haute.",
    },
  ],
  pricing: [
    {
      id: "pricing_build",
      label: "Construction des prix",
      instruction:
        "Comprendre comment le prix est construit, par qui, avec quels outils et quelles données, et où se situent les arbitrages importants.",
    },
    {
      id: "pricing_margin_strategy",
      label: "Stratégie de marge",
      instruction:
        "Comprendre la stratégie de marge : objectifs, seuils, logique économique et ce sur quoi elle se fonde selon les marchés, clients ou types d'affaires.",
    },
    {
      id: "pricing_transmission",
      label: "Transmission et validation",
      instruction:
        "Comprendre comment la stratégie de prix et de marge est transmise aux équipes, contrôlée et arbitrée, notamment lors de la validation et de la négociation des offres.",
    },
    {
      id: "pricing_mustwin",
      label: "Dossiers Must Win",
      instruction:
        "Identifier s'il existe des dossiers Must Win et comprendre comment ils sont qualifiés, qui décide du statut Must Win et quelles dérogations ou arbitrages cela peut entraîner sur le prix ou la marge.",
    },
  ],
  execution: [
    {
      id: "execution_safety",
      label: "Sécurité des personnes",
      instruction:
        "Comprendre comment la sécurité des personnes est gérée concrètement : responsabilités, prévention, analyse des événements, rituels et implication du management.",
    },
    {
      id: "execution_customer",
      label: "Satisfaction client",
      instruction:
        "Comprendre comment la satisfaction client est évaluée et gérée : retours, réclamations, mesures, traitement des écarts et apprentissage collectif.",
    },
    {
      id: "execution_productivity",
      label: "Productivité et préparation",
      instruction:
        "Comprendre comment la productivité est obtenue et sécurisée : préparation, méthodes, adéquation des compétences, organisation, charge/capacité, et comment elle est réellement mesurée.",
    },
    {
      id: "execution_rituals",
      label: "Rituels de gestion",
      instruction:
        "Identifier les rituels de gestion existants et comprendre leur efficacité réelle : affaires, charge, production, marge, facturation, cash, sécurité, prévisions et décisions prises.",
    },
  ],
};

const AREA_EXPECTATIONS: Record<DialogueArea, string[]> = {
  context: [
    "résultats sur les trois exercices disponibles",
    "histoire récente et événements structurants",
    "perception du dirigeant sur la période",
    "moments de rupture, décisions et héritage actuel",
  ],
  rh: [
    "équipe d'encadrement avec points forts, points faibles et fragilités",
    "gestion des compétences et de la formation",
    "état d'esprit des équipes et climat social",
    "recrutement, fidélisation et pilotage RH",
  ],
  commercial: [
    "axes de développement",
    "motivations et logique de choix des axes",
    "points forts et promesse commerciale",
    "preuve que la stratégie est construite et mise en mouvement",
  ],
  pricing: [
    "construction des prix, acteurs et outils",
    "stratégie de marge et fondements",
    "transmission, validation et arbitrages",
    "existence et traitement des dossiers Must Win",
  ],
  execution: [
    "gestion de la sécurité des personnes",
    "gestion de la satisfaction client",
    "productivité, préparation, compétences et mesure",
    "rituels de gestion et efficacité du pilotage",
  ],
};

const CONSULTANT_DOCTRINE = `
DOCTRINE DE RAISONNEMENT — DIAGNOSTIC OPÉRATIONNEL

Tu ne fais pas un questionnaire de contrôle. Tu conduis un entretien de diagnostic avec un dirigeant.

1. Les chiffres servent à ORIENTER le dialogue, pas à l'occuper. Utilise-les comme signaux pour repérer une rupture, un déséquilibre ou un sujet à comprendre qualitativement.
2. Ne demande pas au dirigeant de détailler, reconstituer ou compléter des chiffres déjà saisis dans les tableaux structurés.
3. Une donnée chiffrée manquante reste une donnée inconnue. Elle ne devient pas automatiquement une question. Ne poursuis un chiffre manquant que si une contradiction rend réellement le raisonnement impossible.
4. Les questions doivent prioritairement éclairer les phénomènes : contexte, pratiques, décisions, comportements, compétences, organisation, mécanismes de gestion et causes probables.
5. Tu peux citer un chiffre déjà fourni pour ancrer une question, mais la réponse recherchée doit être qualitative ou contextuelle, pas une nouvelle valeur numérique.
6. Cherche des chaînes causales : FAIT → MÉCANISME → CONSÉQUENCE → RISQUE → LEVIER.
7. Distingue toujours fait établi, perception du dirigeant, interprétation et hypothèse.
8. Ne transforme jamais une anomalie en conclusion sans la tester.
9. Cherche ce qui change une décision de dirigeant. Si la réponse ne change ni le diagnostic, ni la priorité, ni le plan d'actions, la question est probablement faible.
10. À partir de l'itération 2, approfondis seulement les points significatifs révélés par l'itération 1. À l'itération 3, confirme ou infirme les hypothèses les plus importantes.
11. Le style attendu est celui d'un consultant expérimenté : direct, concret, contextualisé, sans jargon inutile et sans série de demandes de données.
`.trim();

function expectedCount(iteration: number) {
  if (iteration === 1) return 4;
  if (iteration === 2) return 3;
  return 2;
}

function iterationInstruction(area: DialogueArea, iteration: number) {
  if (iteration === 1) {
    const passages = MANDATORY_PASSAGES[area]
      .map((p, index) => `${index + 1}. ${p.id} — ${p.label} : ${p.instruction}`)
      .join("\n");

    if (area === "context") {
      return `ÉCHANGE HISTORIQUE — 4 QUESTIONS, UNE SEULE SÉQUENCE
Il n'y aura pas d'itération 2 ni 3 sur ce domaine.
Produis exactement 4 questions, une pour chacun des quatre passages obligés ci-dessous.
Les chiffres de résultats servent uniquement à choisir les phénomènes à éclairer. Ne demande aucun détail chiffré supplémentaire.

PASSAGES OBLIGÉS :
${passages}`;
    }

    return `ITÉRATION 1 — PASSAGES OBLIGÉS DU DOMAINE
Produis exactement 4 questions, une pour chacun des quatre passages obligés ci-dessous.
Si l'information a déjà été donnée, ne la redemande pas : utilise la question pour approfondir la qualité de la pratique, ses limites ou ses conséquences.
Les chiffres servent seulement de signaux d'orientation.

PASSAGES OBLIGÉS :
${passages}`;
  }

  if (iteration === 2) {
    return `ITÉRATION 2 — APPROFONDIR CE QUI LE MÉRITE
Produis exactement 3 questions.
Ne repars pas sur les passages obligés comme une checklist. Choisis les trois points révélés par l'itération 1 qui ont le plus de valeur diagnostique.
Teste les causes, les mécanismes, les arbitrages, les pratiques réelles et les conséquences. Ne demande pas de détails chiffrés.`;
  }

  return `ITÉRATION 3 — CONFIRMER OU INFIRMER
Produis exactement 2 questions.
Choisis les deux hypothèses encore ouvertes qui peuvent le plus modifier le diagnostic ou les priorités d'action.
N'ouvre aucun sujet secondaire et ne demande aucun détail chiffré.`;
}

function clean(value: unknown, max = 1600) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanList(value: unknown, max = 10, itemMax = 900): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    const text = clean(raw, itemMax);
    if (!text || out.includes(text)) continue;
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeHypothesis(raw: any, index: number): DiagnosticHypothesis {
  const confidence = ["low", "medium", "high"].includes(String(raw?.confidence))
    ? (String(raw.confidence) as DiagnosticHypothesis["confidence"])
    : "medium";
  const status = ["open", "supported", "weakened", "confirmed", "rejected"].includes(
    String(raw?.status)
  )
    ? (String(raw.status) as DiagnosticHypothesis["status"])
    : "open";

  return {
    id: clean(raw?.id, 80) || `H${index + 1}`,
    statement: clean(raw?.statement, 1200),
    evidence: cleanList(raw?.evidence, 6, 700),
    confidence,
    potential_impact: clean(raw?.potential_impact, 1000),
    status,
  };
}

function normalizeAnalysis(raw: any): DiagnosticAnalysis {
  return {
    executive_reading: clean(raw?.executive_reading, 2400),
    established_facts: cleanList(raw?.established_facts, 12, 1000),
    key_numbers: cleanList(raw?.key_numbers, 10, 800),
    anomalies: cleanList(raw?.anomalies, 10, 1000),
    contradictions: cleanList(raw?.contradictions, 8, 1000),
    hypotheses: Array.isArray(raw?.hypotheses)
      ? raw.hypotheses
          .map((item: any, index: number) => normalizeHypothesis(item, index))
          .filter((item: DiagnosticHypothesis) => item.statement)
          .slice(0, 6)
      : [],
    stakes: cleanList(raw?.stakes, 8, 1000),
    unresolved_points: cleanList(raw?.unresolved_points, 8, 1000),
    cross_domain_links: cleanList(raw?.cross_domain_links, 6, 1000),
  };
}

function materialForPrompt(material: DialogueAreaMaterial) {
  return {
    initial_material: clean(material.intake_answer, 18000),
    previous_exchanges: (material.qa || []).map((item) => ({
      iteration: item.iteration,
      question: clean(item.question?.question, 1400),
      mandatory_passage_id: clean(item.question?.mandatory_passage_id, 120),
      tested_hypothesis_id: clean(item.question?.tested_hypothesis_id, 100),
      information_sought: clean(item.question?.information_sought, 1000),
      answer: clean(item.answer, 7000),
    })),
    previous_analyses: material.analyses || {},
    validation_feedback: cleanList(material.validation_feedback || [], 6, 2000),
  };
}

function crossDomainForPrompt(memory: CrossDomainMemory[]) {
  return memory.map((item) => ({
    area: item.label,
    synthesis: clean(item.synthesis, 5000),
    executive_reading: clean(item.analysis?.executive_reading, 2500),
    stakes: item.analysis?.stakes || [],
    confirmed_hypotheses: (item.analysis?.hypotheses || [])
      .filter((h) => h.status === "confirmed" || h.status === "supported")
      .map((h) => h.statement)
      .slice(0, 5),
  }));
}

async function chatJson(prompt: string, temperature = 0.2) {
  const resp = await openai.chat.completions.create({
    model: diagnosticModel,
    temperature,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Tu es un consultant senior en diagnostic opérationnel, redressement et performance de PME/ETI. Tu privilégies la compréhension qualitative des phénomènes, tu testes tes hypothèses et tu réponds uniquement en JSON valide.",
      },
      { role: "user", content: prompt },
    ],
  });

  const raw = resp.choices[0]?.message?.content ?? "{}";
  return JSON.parse(raw);
}

export async function analyzeDiagnosticState(params: {
  area: DialogueArea;
  material: DialogueAreaMaterial;
  crossDomainMemory?: CrossDomainMemory[];
  stage: string;
}): Promise<DiagnosticAnalysis> {
  const prompt = `
${CONSULTANT_DOCTRINE}

Construis l'ÉTAT DU DIAGNOSTIC, pas des questions.

DOMAINE : ${AREA_LABELS[params.area]}
ÉTAPE : ${params.stage}

PASSAGES ATTENDUS DANS LE DOMAINE :
${AREA_EXPECTATIONS[params.area].map((x) => `- ${x}`).join("\n")}

MÉMOIRE DES DOMAINES PRÉCÉDENTS :
${JSON.stringify(crossDomainForPrompt(params.crossDomainMemory || []), null, 2)}

MATIÈRE DU DOMAINE :
${JSON.stringify(materialForPrompt(params.material), null, 2)}

RÈGLES D'ANALYSE :
- ne fabrique aucun chiffre ;
- les chiffres disponibles servent à repérer les sujets, pas à créer une liste de données manquantes ;
- ne place pas dans unresolved_points une simple donnée chiffrée absente, sauf si elle bloque réellement une conclusion majeure ;
- privilégie les mécanismes qualitatifs, les pratiques de management, les décisions, l'organisation, les compétences et les comportements ;
- distingue fait, perception, interprétation et hypothèse ;
- formule des hypothèses causales falsifiables ;
- limite-toi aux enjeux qui peuvent influencer une décision ou un plan d'actions.

Retourne STRICTEMENT :
{
  "executive_reading": "lecture provisoire en 3 à 6 phrases",
  "established_facts": ["..."],
  "key_numbers": ["uniquement les chiffres déjà transmis qui orientent réellement le diagnostic"],
  "anomalies": ["..."],
  "contradictions": ["..."],
  "hypotheses": [
    {
      "id": "H1",
      "statement": "...",
      "evidence": ["..."],
      "confidence": "low|medium|high",
      "potential_impact": "...",
      "status": "open|supported|weakened|confirmed|rejected"
    }
  ],
  "stakes": ["..."],
  "unresolved_points": ["points qualitatifs ou causaux à éclaircir"],
  "cross_domain_links": ["..."]
}
`.trim();

  return normalizeAnalysis(await chatJson(prompt, 0.16));
}

function normalizeQuestion(raw: any, area: DialogueArea, iteration: number, index: number) {
  return {
    fact_id: `${area}-i${iteration}-q${index + 1}`,
    theme: clean(raw?.theme, 220) || AREA_LABELS[area],
    constat: clean(raw?.constat, 1400),
    risque_managerial: clean(raw?.risque_managerial, 1400),
    question: clean(raw?.question, 1600),
    mandatory_passage_id: clean(raw?.mandatory_passage_id, 120),
    tested_hypothesis_id: clean(raw?.tested_hypothesis_id, 100),
    information_sought: clean(raw?.information_sought, 1200),
    decision_value: clean(raw?.decision_value, 1200),
  } as DialogueQuestion;
}

function looksLikeNumericCollection(question: string) {
  const q = question.toLowerCase();
  return /\b(combien|quel montant|quelle somme|quel pourcentage|quel taux|chiffre exact|détailler les chiffres|détailler les montants|répartition chiffrée)\b/.test(q);
}

function validateQuestions(raw: unknown, area: DialogueArea, iteration: number) {
  if (!Array.isArray(raw) || raw.length !== expectedCount(iteration)) return null;
  const questions = raw.map((item, index) => normalizeQuestion(item, area, iteration, index));

  if (
    questions.some(
      (q) =>
        q.question.length < 30 ||
        q.constat.length < 20 ||
        q.risque_managerial.length < 20 ||
        q.information_sought!.length < 15 ||
        q.decision_value!.length < 15 ||
        looksLikeNumericCollection(q.question) ||
        (iteration >= 2 && !q.tested_hypothesis_id)
    )
  ) {
    return null;
  }

  if (iteration === 1) {
    const expectedPassages = new Set(MANDATORY_PASSAGES[area].map((p) => p.id));
    const received = questions.map((q) => q.mandatory_passage_id).filter(Boolean) as string[];
    if (received.length !== 4 || new Set(received).size !== 4) return null;
    if (received.some((id) => !expectedPassages.has(id))) return null;
  }

  const unique = new Set(questions.map((q) => q.question.toLowerCase()));
  if (unique.size !== questions.length) return null;
  return questions;
}

async function callQuestionPlanner(params: {
  area: DialogueArea;
  iteration: number;
  material: DialogueAreaMaterial;
  analysis: DiagnosticAnalysis;
  crossDomainMemory?: CrossDomainMemory[];
  retry?: boolean;
}) {
  const count = expectedCount(params.iteration);
  const prompt = `
${CONSULTANT_DOCTRINE}

Tu dois choisir les questions les plus utiles pour faire PROGRESSER LE DIAGNOSTIC.

DOMAINE : ${AREA_LABELS[params.area]}
${iterationInstruction(params.area, params.iteration)}

ÉTAT DIAGNOSTIQUE ACTUEL :
${JSON.stringify(params.analysis, null, 2)}

MÉMOIRE DES DOMAINES PRÉCÉDENTS :
${JSON.stringify(crossDomainForPrompt(params.crossDomainMemory || []), null, 2)}

MATIÈRE ET ÉCHANGES DU DOMAINE :
${JSON.stringify(materialForPrompt(params.material), null, 2)}

CONTRAT DE QUALITÉ :
- produis EXACTEMENT ${count} questions ;
- les chiffres déjà transmis peuvent être cités pour ancrer la discussion, mais ne demande pas de nouveaux chiffres ni de détail chiffré ;
- cherche une explication qualitative : pourquoi, comment, avec quelles pratiques, quelles décisions, quelles compétences, quelles conséquences ;
- ne demande jamais une information déjà donnée ;
- une question = un enjeu principal ;
- en itération 1, renseigne mandatory_passage_id avec l'identifiant exact du passage couvert, et couvre chacun des quatre passages une seule fois ;
- en itérations 2 et 3, rattache chaque question à une hypothèse existante via tested_hypothesis_id ;
- privilégie les questions qui peuvent changer le diagnostic, la priorité ou le plan d'actions ;
- formule naturellement la question, comme dans un entretien avec un dirigeant ;
- interdiction des questions de collecte chiffrée ou des questions génériques sans ancrage.

Retourne STRICTEMENT :
{
  "questions": [
    {
      "theme": "string",
      "constat": "ce qui motive la question",
      "risque_managerial": "pourquoi ce point compte",
      "mandatory_passage_id": "identifiant exact en itération 1, vide sinon",
      "tested_hypothesis_id": "H1 en itération 2/3, vide en itération 1 sauf besoin",
      "information_sought": "ce que la réponse doit permettre de comprendre qualitativement",
      "decision_value": "ce qui changera dans le diagnostic ou la priorité selon la réponse",
      "question": "question naturelle, contextuelle et précise"
    }
  ]
}

${params.retry ? "La réponse précédente n'a pas respecté le contrat. Corrige strictement les passages obligés, le nombre de questions, les champs et supprime toute demande de détail chiffré." : ""}
`.trim();

  const parsed = await chatJson(prompt, params.iteration === 1 ? 0.24 : 0.16);
  return validateQuestions(parsed?.questions, params.area, params.iteration);
}

export async function generateDiagnosticQuestions(params: {
  area: DialogueArea;
  iteration: number;
  material: DialogueAreaMaterial;
  analysis: DiagnosticAnalysis;
  crossDomainMemory?: CrossDomainMemory[];
}): Promise<DialogueQuestion[]> {
  const first = await callQuestionPlanner(params);
  if (first) return first;
  const retry = await callQuestionPlanner({ ...params, retry: true });
  if (retry) return retry;
  throw new Error(`V5_QUESTION_CONTRACT_FAILED:${params.area}:iteration_${params.iteration}`);
}

export function formatIntermediateSynthesis(params: {
  area: DialogueArea;
  iteration: number;
  analysis: DiagnosticAnalysis;
}) {
  const maxIterations = maxIterationsForArea(params.area);
  const title = `Bilan intermédiaire — ${AREA_LABELS[params.area]} — après l’itération ${params.iteration}/${maxIterations}`;
  const lines: string[] = [
    title,
    "",
    "Lecture à ce stade",
    params.analysis.executive_reading || "Analyse en cours.",
  ];

  if (params.analysis.established_facts.length) {
    lines.push("", "Constats établis");
    for (const item of params.analysis.established_facts.slice(0, 5)) lines.push(`• ${item}`);
  }
  if (params.analysis.anomalies.length) {
    lines.push("", "Points d’étonnement / écarts");
    for (const item of params.analysis.anomalies.slice(0, 4)) lines.push(`• ${item}`);
  }
  const openHypotheses = params.analysis.hypotheses.filter(
    (h) => h.status === "open" || h.status === "supported" || h.status === "weakened"
  );
  if (openHypotheses.length) {
    lines.push("", "Hypothèses à tester");
    for (const h of openHypotheses.slice(0, 4)) {
      lines.push(`• ${h.id} — ${h.statement} [confiance : ${h.confidence}]`);
    }
  }
  if (params.analysis.unresolved_points.length) {
    lines.push("", "Points encore non résolus");
    for (const item of params.analysis.unresolved_points.slice(0, 4)) lines.push(`• ${item}`);
  }
  return lines.join("\n");
}

function normalizeSwot(raw: any): DiagnosticSwot {
  return {
    strengths: cleanList(raw?.strengths, 6, 800),
    weaknesses: cleanList(raw?.weaknesses, 6, 800),
    opportunities: cleanList(raw?.opportunities, 6, 800),
    threats: cleanList(raw?.threats, 6, 800),
  };
}

export async function buildDomainConclusion(params: {
  area: DialogueArea;
  material: DialogueAreaMaterial;
  analysis: DiagnosticAnalysis;
  crossDomainMemory?: CrossDomainMemory[];
}) {
  const maxIterations = maxIterationsForArea(params.area);
  const prompt = `
${CONSULTANT_DOCTRINE}

Tu dois conclure le domaine ${AREA_LABELS[params.area]} après ${maxIterations === 1 ? "un échange de quatre questions" : "trois itérations d'entretien"}.

ÉTAT DIAGNOSTIQUE FINAL :
${JSON.stringify(params.analysis, null, 2)}

ÉCHANGES :
${JSON.stringify(materialForPrompt(params.material), null, 2)}

MÉMOIRE DES DOMAINES PRÉCÉDENTS :
${JSON.stringify(crossDomainForPrompt(params.crossDomainMemory || []), null, 2)}

Ta conclusion doit :
- distinguer ce qui est établi de ce qui relève encore d'une perception ou d'une hypothèse ;
- faire ressortir 2 à 5 constats qui structurent réellement la performance ;
- utiliser les chiffres déjà fournis uniquement pour étayer ces constats, sans inventer de précision ;
- mettre en évidence les causes probables et les mécanismes qualitatifs, pas seulement les symptômes ;
- produire un SWOT spécifique à ce domaine ;
- ne pas encore rédiger un plan d'actions détaillé.

Retourne STRICTEMENT :
{
  "synthesis": "synthèse dirigeant, 2 à 5 paragraphes courts",
  "swot": {
    "strengths": ["..."],
    "weaknesses": ["..."],
    "opportunities": ["..."],
    "threats": ["..."]
  }
}
`.trim();

  const parsed = await chatJson(prompt, 0.16);
  return {
    synthesis: clean(parsed?.synthesis, 7000),
    swot: normalizeSwot(parsed?.swot),
  };
}

export function formatDomainReview(params: {
  area: DialogueArea;
  synthesis: string;
  swot: DiagnosticSwot;
}) {
  const lines = [
    `Bilan du domaine — ${AREA_LABELS[params.area]}`,
    "",
    params.synthesis,
    "",
    "SWOT",
    "Forces",
    ...params.swot.strengths.map((x) => `• ${x}`),
    "",
    "Faiblesses",
    ...params.swot.weaknesses.map((x) => `• ${x}`),
    "",
    "Opportunités",
    ...params.swot.opportunities.map((x) => `• ${x}`),
    "",
    "Menaces",
    ...params.swot.threats.map((x) => `• ${x}`),
    "",
    "Ce bilan vous paraît-il juste ? Répondez « oui » pour le valider, ou indiquez ce que vous souhaitez corriger ou nuancer.",
  ];
  return lines.join("\n");
}

export function nextArea(area: DialogueArea): DialogueArea | null {
  const index = AREA_ORDER.indexOf(area);
  if (index < 0 || index >= AREA_ORDER.length - 1) return null;
  return AREA_ORDER[index + 1];
}

export function dimensionForArea(area: DialogueArea): number | null {
  if (area === "rh") return 1;
  if (area === "commercial") return 2;
  if (area === "pricing") return 3;
  if (area === "execution") return 4;
  return null;
}
