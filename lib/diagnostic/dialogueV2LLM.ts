import OpenAI from "openai";

export type DialogueArea =
  | "context"
  | "rh"
  | "commercial"
  | "pricing"
  | "execution";

export type DialogueQuestion = {
  fact_id: string;
  theme: string;
  constat: string;
  risque_managerial: string;
  question: string;
};

export type DialogueQa = {
  iteration: number;
  question: DialogueQuestion;
  answer: string;
};

export type DialogueAreaMaterial = {
  intake_answer: string;
  qa: DialogueQa[];
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

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

function expectedCount(iteration: number) {
  if (iteration === 1) return 4;
  if (iteration === 2) return 3;
  return 2;
}

function iterationInstruction(iteration: number) {
  if (iteration === 1) {
    return `ITÉRATION 1 — RAPPORT D'ÉTONNEMENT ET COMPLÉTUDE
Tu dois produire exactement 4 questions.
Priorise :
1. les éléments attendus réellement manquants ou non suivis ;
2. les précisions nécessaires pour rendre les chiffres comparables et exploitables ;
3. les incohérences, ruptures, écarts ou concentrations qui méritent une explication ;
4. les points d'étonnement qu'un consultant expérimenté relèverait à la lecture de la matière reçue.
Ne cherche pas encore à conclure trop vite sur une cause racine.`;
  }

  if (iteration === 2) {
    return `ITÉRATION 2 — APPROFONDISSEMENT DES RÉPONSES
Tu dois produire exactement 3 questions.
Les questions doivent être construites à partir des réponses de l'itération 1, et non repartir de zéro.
Approfondis les mécanismes, les causes possibles, les arbitrages, la fiabilité des données et les conséquences opérationnelles ou économiques.
Ne répète aucune question déjà posée.`;
  }

  return `ITÉRATION 3 — CONFIRMATION / INFIRMATION
Tu dois produire exactement 2 questions.
À ce stade, n'ouvre pas de nouveau sujet sauf anomalie majeure.
Formule deux questions permettant de confirmer ou d'infirmer les hypothèses les plus importantes qui se dégagent des réponses précédentes.
Cherche une conclusion diagnostique robuste, factuelle et utile au plan d'actions.`;
}

function clean(value: unknown, max = 1200) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function buildMaterialForPrompt(material: DialogueAreaMaterial) {
  return {
    initial_material: clean(material.intake_answer, 12000),
    previous_exchanges: (material.qa || []).map((item) => ({
      iteration: item.iteration,
      question: clean(item.question?.question, 1200),
      answer: clean(item.answer, 6000),
      theme: clean(item.question?.theme, 240),
      constat: clean(item.question?.constat, 1200),
    })),
  };
}

function normalizeQuestion(raw: any, area: DialogueArea, iteration: number, index: number): DialogueQuestion {
  const question = clean(raw?.question, 1400);
  const theme = clean(raw?.theme, 220) || AREA_LABELS[area];
  const constat = clean(raw?.constat, 1400);
  const risque = clean(raw?.risque_managerial, 1400);

  return {
    fact_id: `${area}-i${iteration}-q${index + 1}`,
    theme,
    constat,
    risque_managerial: risque,
    question,
  };
}

function validateBatch(
  rawQuestions: unknown,
  area: DialogueArea,
  iteration: number
): DialogueQuestion[] | null {
  if (!Array.isArray(rawQuestions)) return null;
  const count = expectedCount(iteration);
  if (rawQuestions.length !== count) return null;

  const normalized = rawQuestions.map((item, index) =>
    normalizeQuestion(item, area, iteration, index)
  );

  if (
    normalized.some(
      (item) =>
        item.question.length < 20 ||
        item.constat.length < 10 ||
        item.risque_managerial.length < 10
    )
  ) {
    return null;
  }

  const unique = new Set(normalized.map((item) => item.question.toLowerCase()));
  if (unique.size !== normalized.length) return null;

  return normalized;
}

async function callPlanner(params: {
  area: DialogueArea;
  iteration: number;
  material: DialogueAreaMaterial;
  retry?: boolean;
}) {
  const { area, iteration, material, retry = false } = params;
  const count = expectedCount(iteration);

  const prompt = `
Tu conduis un diagnostic opérationnel d'entreprise avec un dirigeant.
Tu es le consultant qui mène l'entretien. L'application ne choisit pas les questions à ta place : elle garantit seulement le domaine, l'itération et le nombre de questions.

DOMAINE : ${AREA_LABELS[area]}

ÉLÉMENTS ATTENDUS DANS CE DOMAINE :
${AREA_EXPECTATIONS[area].map((item) => `- ${item}`).join("\n")}

${iterationInstruction(iteration)}

RÈGLES ABSOLUES :
- reste strictement dans le domaine ${AREA_LABELS[area]} ;
- exploite la matière réellement transmise ;
- si une donnée attendue est absente, tu peux demander pourquoi elle n'est pas disponible ou comment elle est suivie, mais ne suppose jamais sa valeur ;
- distingue fait, hypothèse et interprétation ;
- les questions doivent être naturelles dans un entretien de dirigeant ;
- une question = un enjeu principal ;
- évite les formulations scolaires, génériques ou mécaniques ;
- n'invente aucun chiffre ni aucun fait ;
- en itération 2 et 3, appuie-toi explicitement sur les réponses déjà obtenues ;
- produis EXACTEMENT ${count} questions.

Pour chaque question retourne :
- theme : thème court ;
- constat : le fait, manque, écart ou étonnement qui justifie la question ;
- risque_managerial : pourquoi ce point mérite d'être éclairci pour le dirigeant ;
- question : la question à poser.

Retourne STRICTEMENT ce JSON :
{
  "questions": [
    {
      "theme": "string",
      "constat": "string",
      "risque_managerial": "string",
      "question": "string"
    }
  ]
}

MATIÈRE DISPONIBLE :
${JSON.stringify(buildMaterialForPrompt(material), null, 2)}

${retry ? "ATTENTION : la réponse précédente n'a pas respecté le contrat de sortie. Respecte exactement le nombre de questions et tous les champs." : ""}
`.trim();

  const resp = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL_CHAT || "gpt-4o-mini",
    temperature: iteration === 1 ? 0.35 : 0.25,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Tu es un consultant senior en diagnostic opérationnel. Tu conduis l'entretien, tu raisonnes à partir des faits fournis et tu réponds uniquement en JSON valide.",
      },
      { role: "user", content: prompt },
    ],
  });

  const raw = resp.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw);
  return validateBatch(parsed?.questions, area, iteration);
}

export async function generateDialogueQuestions(params: {
  area: DialogueArea;
  iteration: number;
  material: DialogueAreaMaterial;
}): Promise<DialogueQuestion[]> {
  const first = await callPlanner(params);
  if (first) return first;

  const retry = await callPlanner({ ...params, retry: true });
  if (retry) return retry;

  throw new Error(
    `LLM_QUESTION_CONTRACT_FAILED:${params.area}:iteration_${params.iteration}`
  );
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
