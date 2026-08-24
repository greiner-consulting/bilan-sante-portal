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

export const AREA_INTAKE_PROMPTS: Record<DialogueArea, string> = {
  context: `Nous allons commencer par comprendre l’histoire récente de l’entreprise et l’évolution de ses résultats.

Présentez-moi les événements qui ont marqué les trois dernières années : évolution de l’activité, changements importants, difficultés rencontrées, décisions structurantes ou éléments expliquant la trajectoire actuelle.

Ajoutez, pour chacun des trois derniers exercices si vous les avez :
- chiffre d’affaires ou production ;
- marge brute en montant et en % ;
- frais généraux en montant et en % ;
- marge nette.

Vous pouvez répondre sous forme de texte ou de tableau. Si certains éléments ne sont pas disponibles, indiquez-le simplement.`,

  rh: `Passons au domaine Organisation & RH.

Présentez-moi les éléments dont vous disposez sur les trois dernières années, ou sur la période disponible :
- effectif total et évolution ;
- nombre de salariés par collège : cadres, employés/ETAM et ouvriers ;
- ancienneté moyenne ou répartition de l’ancienneté ;
- turnover ;
- nombre de démissions et principaux départs ;
- recrutements significatifs et postes difficiles à pourvoir ;
- organisation managériale, responsabilités clés et éventuels postes ou compétences critiques.

Si certaines données ne sont pas suivies ou ne sont pas disponibles, dites-le explicitement.`,

  commercial: `Passons au domaine Commercial & Marchés.

Présentez-moi, si possible :
- le Top 10 des clients, avec pour chacun la production ou le chiffre d’affaires et la marge associée ;
- le poids des principaux clients dans l’activité ;
- les marchés, secteurs ou types d’affaires aujourd’hui recherchés ;
- les axes de développement formalisés pour les prochaines années.

S’il n’existe pas de stratégie commerciale ou d’axes de développement formalisés, indiquez-le simplement : c’est une information de diagnostic à part entière.`,

  pricing: `Passons au domaine Cycle de vente & Prix.

Présentez-moi le funnel commercial actuel, avec les montants et les marges lorsqu’ils sont disponibles :
- projets identifiés ;
- devis ou offres en cours de chiffrage ;
- devis ou offres remis ;
- carnet de commandes.

Ajoutez les éléments disponibles sur :
- la durée et les étapes du cycle de vente ;
- la manière dont les affaires sont qualifiées ;
- la façon dont les prix et les devis sont construits ;
- les règles de marge, de validation et de négociation ;
- les critères éventuels de go/no-go.

Si certaines étapes ou données ne sont pas suivies, précisez-le.`,

  execution: `Terminons par le domaine Exécution & Performance opérationnelle.

Présentez-moi, si possible :
- le Top 10 des clients ou affaires les plus contributeurs à la marge ;
- le Flop 10 des clients ou affaires les plus pénalisants pour la marge ;
- les principales causes connues d’écart entre marge vendue et marge réalisée ;
- les éléments disponibles sur la satisfaction ou les réclamations clients ;
- les indicateurs de sécurité des personnes ;
- les principaux rituels managériaux et opérationnels : affaires, charge/capacité, production, facturation, cash, sécurité, prévisions.

Si certaines informations ne sont pas mesurées ou consolidées, indiquez-le explicitement.`,
};

const AREA_EXPECTATIONS: Record<DialogueArea, string[]> = {
  context: [
    "histoire et événements structurants des trois dernières années",
    "production ou chiffre d’affaires sur trois exercices",
    "marge brute en montant et en pourcentage",
    "frais généraux en montant et en pourcentage",
    "marge nette",
    "explication des ruptures de tendance",
  ],
  rh: [
    "effectif et évolution",
    "effectifs cadres, employés/ETAM, ouvriers",
    "ancienneté",
    "turnover",
    "démissions et départs",
    "recrutements et postes difficiles",
    "organisation managériale",
    "postes ou compétences critiques",
  ],
  commercial: [
    "Top 10 clients avec production ou CA et marge",
    "concentration du portefeuille",
    "marchés et secteurs ciblés",
    "axes de développement",
    "existence ou absence de stratégie commerciale formalisée",
  ],
  pricing: [
    "projets identifiés avec montant et marge",
    "devis en chiffrage avec montant et marge",
    "devis remis avec montant et marge",
    "carnet de commandes avec montant et marge",
    "cycle de vente",
    "qualification des affaires",
    "construction des prix et devis",
    "règles de marge et validations",
    "négociation et go/no-go",
  ],
  execution: [
    "Top 10 contributeurs à la marge",
    "Flop 10 pénalisants pour la marge",
    "écarts marge vendue / marge réalisée",
    "satisfaction et réclamations clients",
    "sécurité des personnes",
    "rituels de pilotage affaires, charge, production, facturation, cash et prévisions",
  ],
};

const CONSULTANT_DOCTRINE = `
DOCTRINE DE RAISONNEMENT — DIAGNOSTIC OPÉRATIONNEL

Tu ne fais pas un questionnaire. Tu conduis un diagnostic de dirigeant.

1. Un chiffre isolé n'est pas un diagnostic. Compare-le à l'année précédente, au budget, à l'objectif, au carnet, à la structure ou à un autre indicateur pertinent.
2. Cherche les ruptures et les déséquilibres : charge/capacité, structure/volume, marge vendue/marge réalisée, carnet/objectif, effectifs/production, concentration client/stratégie.
3. Cherche des chaînes causales : FAIT → MÉCANISME → CONSÉQUENCE → RISQUE → LEVIER.
4. Une donnée manquante ne mérite une question que si son absence empêche de conclure sur un enjeu significatif.
5. Distingue toujours fait établi, interprétation et hypothèse.
6. Ne transforme jamais une anomalie en conclusion sans la tester.
7. Quantifie l'enjeu dès que la matière le permet : ordre de grandeur de marge, sous-charge, sureffectif, perte de volume, concentration ou risque.
8. Cherche ce qui change une décision de dirigeant. Si la réponse à une question ne change ni le diagnostic, ni la priorité, ni le plan d'actions, la question est probablement faible.
9. Une bonne question peut confronter deux informations : par exemple croissance des frais généraux vs croissance de la production, marge budgétaire vs marge du carnet, faible encadrement vs stratégie de diversification.
10. À partir de l'itération 2, ne reviens pas à la collecte générale. À l'itération 3, ne demande plus des détails secondaires : confirme ou infirme les hypothèses qui changeraient le plus le diagnostic.

EXEMPLES DE NIVEAU DE RAISONNEMENT ATTENDU — À ADAPTER, JAMAIS À COPIER :
- Si un budget exige +9 points de marge brute alors que le niveau actuel reste très inférieur, le sujet n'est pas seulement le chiffre : il faut identifier quels mécanismes concrets rendent cette progression crédible ou non.
- Si les frais généraux progressent beaucoup plus vite que la production, il faut déterminer s'il s'agit d'un problème de structure, de pointage, de sous-charge ou d'organisation.
- Si l'effectif cadre paraît faible au regard de la taille de l'entité et que la stratégie suppose de diversifier les activités, il faut tester la capacité réelle de l'encadrement à absorber cette transformation.
- Si une activité ou quelques affaires expliquent l'essentiel des pertes, il faut distinguer accident ponctuel, défaut de sélection, défaut de chiffrage et défaut d'exécution.
`.trim();

function expectedCount(iteration: number) {
  if (iteration === 1) return 4;
  if (iteration === 2) return 3;
  return 2;
}

function iterationInstruction(iteration: number) {
  if (iteration === 1) {
    return `ITÉRATION 1 — COMPLÉTER ET CHALLENGER LA MATIÈRE
Produis exactement 4 questions.
Priorise les informations critiques manquantes, les écarts chiffrés, les incohérences et les rapports d'étonnement.
Une question peut tester une première hypothèse, mais n'essaie pas encore de conclure trop vite.`;
  }

  if (iteration === 2) {
    return `ITÉRATION 2 — TESTER LES MÉCANISMES ET LES CAUSES
Produis exactement 3 questions.
Pars de l'état diagnostique déjà construit et des réponses de l'itération 1.
Chaque question doit tester une hypothèse, un mécanisme causal, un arbitrage ou une conséquence importante.
Interdiction de repartir en collecte générale ou de reposer une question déjà couverte.`;
  }

  return `ITÉRATION 3 — CONFIRMER OU INFIRMER LE DIAGNOSTIC
Produis exactement 2 questions.
Choisis les deux hypothèses encore ouvertes qui ont le plus d'impact sur le diagnostic ou le plan d'actions.
N'ouvre pas de sujet secondaire. Ne demande pas une donnée descriptive tardive sauf si elle est indispensable pour trancher une hypothèse majeure.`;
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
    initial_material: clean(material.intake_answer, 16000),
    previous_exchanges: (material.qa || []).map((item) => ({
      iteration: item.iteration,
      question: clean(item.question?.question, 1400),
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
          "Tu es un consultant senior en diagnostic opérationnel, redressement et performance de PME/ETI. Tu raisonnes à partir des faits, tu quantifies les enjeux, tu testes tes hypothèses et tu réponds uniquement en JSON valide.",
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

Tu dois maintenant construire l'ÉTAT DU DIAGNOSTIC, pas des questions.

DOMAINE : ${AREA_LABELS[params.area]}
ÉTAPE : ${params.stage}

ÉLÉMENTS NORMALEMENT ATTENDUS DANS CE DOMAINE :
${AREA_EXPECTATIONS[params.area].map((x) => `- ${x}`).join("\n")}

MÉMOIRE DES DOMAINES PRÉCÉDENTS :
${JSON.stringify(crossDomainForPrompt(params.crossDomainMemory || []), null, 2)}

MATIÈRE DU DOMAINE :
${JSON.stringify(materialForPrompt(params.material), null, 2)}

RÈGLES :
- ne fabrique aucun chiffre ;
- si une information est absente, dis qu'elle est absente ;
- ne confonds pas un commentaire du dirigeant avec un fait vérifié ;
- rapproche les chiffres entre eux quand cela crée un diagnostic utile ;
- fais apparaître les hypothèses causales qui méritent d'être testées ;
- une hypothèse doit être formulée de manière falsifiable ;
- limite-toi aux enjeux qui peuvent réellement influencer une décision ou un plan d'actions.

Retourne STRICTEMENT :
{
  "executive_reading": "lecture provisoire en 3 à 6 phrases",
  "established_facts": ["..."],
  "key_numbers": ["..."],
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
  "unresolved_points": ["..."],
  "cross_domain_links": ["..."]
}
`.trim();

  const parsed = await chatJson(prompt, 0.18);
  return normalizeAnalysis(parsed);
}

function normalizeQuestion(raw: any, area: DialogueArea, iteration: number, index: number) {
  return {
    fact_id: `${area}-i${iteration}-q${index + 1}`,
    theme: clean(raw?.theme, 220) || AREA_LABELS[area],
    constat: clean(raw?.constat, 1400),
    risque_managerial: clean(raw?.risque_managerial, 1400),
    question: clean(raw?.question, 1600),
    tested_hypothesis_id: clean(raw?.tested_hypothesis_id, 100),
    information_sought: clean(raw?.information_sought, 1200),
    decision_value: clean(raw?.decision_value, 1200),
  } as DialogueQuestion;
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
        (iteration >= 2 && !q.tested_hypothesis_id)
    )
  ) {
    return null;
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
L'application impose seulement le domaine, l'itération et le nombre de questions. C'est toi qui conduis l'entretien.

DOMAINE : ${AREA_LABELS[params.area]}
${iterationInstruction(params.iteration)}

ÉTAT DIAGNOSTIQUE ACTUEL :
${JSON.stringify(params.analysis, null, 2)}

MÉMOIRE DES DOMAINES PRÉCÉDENTS :
${JSON.stringify(crossDomainForPrompt(params.crossDomainMemory || []), null, 2)}

MATIÈRE ET ÉCHANGES DU DOMAINE :
${JSON.stringify(materialForPrompt(params.material), null, 2)}

CONTRAT DE QUALITÉ :
- produis EXACTEMENT ${count} questions ;
- chaque question doit avoir une raison diagnostique explicite ;
- ne demande jamais une information déjà donnée ;
- une question = un enjeu principal ;
- privilégie les questions qui peuvent changer le diagnostic, la priorité ou le plan d'actions ;
- en itération 2 et 3, rattache chaque question à une hypothèse existante via tested_hypothesis_id ;
- si une hypothèse importante peut être quantifiée, cherche l'ordre de grandeur utile ;
- formule naturellement la question, comme dans un entretien avec un dirigeant ;
- interdiction des questions génériques du type « pouvez-vous préciser ? » sans ancrage ;
- interdiction en itération 3 de collecter un détail secondaire qui aurait dû être demandé au départ.

Retourne STRICTEMENT :
{
  "questions": [
    {
      "theme": "string",
      "constat": "ce que tu as observé et qui motive la question",
      "risque_managerial": "pourquoi ce point peut influencer le diagnostic ou la décision",
      "tested_hypothesis_id": "H1 ou vide seulement en itération 1",
      "information_sought": "ce que la réponse doit permettre de trancher",
      "decision_value": "ce qui changera dans le diagnostic ou la priorité selon la réponse",
      "question": "question naturelle et précise"
    }
  ]
}

${params.retry ? "La réponse précédente n'a pas respecté le contrat. Corrige strictement le nombre de questions, les champs manquants et le niveau diagnostique." : ""}
`.trim();

  const parsed = await chatJson(prompt, params.iteration === 1 ? 0.28 : 0.18);
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
  throw new Error(`V3_QUESTION_CONTRACT_FAILED:${params.area}:iteration_${params.iteration}`);
}

export function formatIntermediateSynthesis(params: {
  area: DialogueArea;
  iteration: number;
  analysis: DiagnosticAnalysis;
}) {
  const title = `Bilan intermédiaire — ${AREA_LABELS[params.area]} — après l’itération ${params.iteration}/3`;
  const lines: string[] = [title, "", "Lecture à ce stade", params.analysis.executive_reading || "Analyse en cours."];

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
  const prompt = `
${CONSULTANT_DOCTRINE}

Tu dois conclure le domaine ${AREA_LABELS[params.area]} après trois itérations d'entretien.

ÉTAT DIAGNOSTIQUE FINAL :
${JSON.stringify(params.analysis, null, 2)}

ÉCHANGES :
${JSON.stringify(materialForPrompt(params.material), null, 2)}

MÉMOIRE DES DOMAINES PRÉCÉDENTS :
${JSON.stringify(crossDomainForPrompt(params.crossDomainMemory || []), null, 2)}

Ta conclusion doit :
- distinguer clairement ce qui est établi de ce qui reste hypothétique ;
- faire ressortir 2 à 5 constats qui structurent réellement la performance ;
- quantifier les enjeux lorsqu'un ordre de grandeur est supporté par les données ;
- mettre en évidence les causes probables et non seulement les symptômes ;
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

  const parsed = await chatJson(prompt, 0.18);
  const synthesis = clean(parsed?.synthesis, 7000);
  const swot = normalizeSwot(parsed?.swot);
  return { synthesis, swot };
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
