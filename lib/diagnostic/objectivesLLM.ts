import OpenAI from "openai";
import type { CrossDomainMemory } from "@/lib/diagnostic/dialogueV5LLM";

export type ResultObjective = {
  id: string;
  title: string;
  rationale: string;
  expected_result: string;
  source_areas: string[];
  priority_reason: string;
};

export type ObjectiveProposal = {
  transversal_reading: string;
  objectives: ResultObjective[];
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const diagnosticModel =
  process.env.OPENAI_MODEL_DIAGNOSTIC ||
  process.env.OPENAI_MODEL_CHAT ||
  "gpt-4o";

function clean(value: unknown, max = 1800) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanList(value: unknown, max = 5, itemMax = 240) {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = clean(item, itemMax);
    if (!text || out.includes(text)) continue;
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeProposal(raw: any): ObjectiveProposal {
  const objectives = Array.isArray(raw?.objectives)
    ? raw.objectives
        .map((item: any, index: number) => ({
          id: clean(item?.id, 40) || `O${index + 1}`,
          title: clean(item?.title, 260),
          rationale: clean(item?.rationale, 1300),
          expected_result: clean(item?.expected_result, 900),
          source_areas: cleanList(item?.source_areas, 5, 120),
          priority_reason: clean(item?.priority_reason, 900),
        }))
        .filter(
          (item: ResultObjective) =>
            item.title && item.rationale && item.expected_result && item.priority_reason
        )
        .slice(0, 5)
    : [];

  if (objectives.length < 3) {
    throw new Error("OBJECTIVES_CONTRACT_FAILED");
  }

  return {
    transversal_reading: clean(raw?.transversal_reading, 3500),
    objectives,
  };
}

function memoryForPrompt(memory: CrossDomainMemory[]) {
  return memory.map((item) => ({
    domain: item.label,
    synthesis: clean(item.synthesis, 6500),
    executive_reading: clean(item.analysis?.executive_reading, 2600),
    stakes: item.analysis?.stakes || [],
    hypotheses: (item.analysis?.hypotheses || [])
      .filter((h) => h.status !== "rejected")
      .map((h) => ({
        statement: h.statement,
        status: h.status,
        confidence: h.confidence,
        potential_impact: h.potential_impact,
      }))
      .slice(0, 6),
  }));
}

async function callObjectiveLLM(prompt: string) {
  const response = await openai.chat.completions.create({
    model: diagnosticModel,
    temperature: 0.16,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Tu es un consultant senior en diagnostic opérationnel. Tu consolides cinq diagnostics validés en quelques objectifs de résultat dirigeant. Tu distingues strictement objectif et action et tu réponds uniquement en JSON valide.",
      },
      { role: "user", content: prompt },
    ],
  });

  return JSON.parse(response.choices[0]?.message?.content ?? "{}");
}

export async function generateObjectiveProposal(params: {
  memory: CrossDomainMemory[];
}): Promise<ObjectiveProposal> {
  const prompt = `
Tu disposes des conclusions validées de cinq séquences d'un diagnostic de dirigeant.

Ta mission est de construire une VISION TRANSVERSALE puis de proposer 3 à 5 OBJECTIFS DE RÉSULTAT.

RÈGLES ABSOLUES :
- un objectif de résultat décrit un état à obtenir ou une performance à restaurer ; ce n'est PAS une action, un chantier, un moyen ou une liste de tâches ;
- ne juxtapose pas mécaniquement un objectif par domaine ; cherche les enjeux transversaux qui expliquent réellement la situation ;
- fusionne les constats qui ont une cause ou une conséquence commune ;
- privilégie les objectifs qui changent matériellement la trajectoire économique, commerciale, humaine ou opérationnelle ;
- chaque objectif doit être justifié par plusieurs constats lorsque c'est pertinent ;
- ne fabrique aucun chiffre cible absent des diagnostics ;
- si les éléments disponibles permettent seulement une direction sans cible chiffrée fiable, formule le résultat attendu qualitativement ;
- ne rédige aucun plan d'actions à ce stade.

DIAGNOSTICS VALIDÉS :
${JSON.stringify(memoryForPrompt(params.memory), null, 2)}

Retourne STRICTEMENT :
{
  "transversal_reading": "lecture dirigeant en 2 à 4 paragraphes courts, montrant les liens entre les domaines",
  "objectives": [
    {
      "id": "O1",
      "title": "objectif de résultat court et concret",
      "rationale": "constats transversaux qui le justifient",
      "expected_result": "ce qui devra être différent lorsque l'objectif sera atteint",
      "source_areas": ["Organisation & RH", "Commercial & Marchés"],
      "priority_reason": "pourquoi cet objectif mérite d'être prioritaire"
    }
  ]
}
`.trim();

  return normalizeProposal(await callObjectiveLLM(prompt));
}

export async function refineObjectiveProposal(params: {
  memory: CrossDomainMemory[];
  current: ObjectiveProposal;
  feedback: string;
}): Promise<ObjectiveProposal> {
  const prompt = `
Tu dois réviser une proposition d'objectifs de résultat après retour du dirigeant.

RÈGLES :
- respecte explicitement les arbitrages, suppressions, ajouts, reformulations ou priorités exprimés par le dirigeant ;
- conserve uniquement 3 à 5 objectifs ;
- chaque objectif reste un RÉSULTAT à obtenir, jamais une action ;
- vérifie que les objectifs restent cohérents avec les diagnostics validés ;
- si le dirigeant demande quelque chose non soutenu par le diagnostic, intègre-le seulement si son retour apporte une information nouvelle explicite ;
- ne crée pas encore de plan d'actions.

DIAGNOSTICS VALIDÉS :
${JSON.stringify(memoryForPrompt(params.memory), null, 2)}

PROPOSITION ACTUELLE :
${JSON.stringify(params.current, null, 2)}

RETOUR DU DIRIGEANT :
${clean(params.feedback, 5000)}

Retourne STRICTEMENT le même format JSON :
{
  "transversal_reading": "lecture dirigeant révisée",
  "objectives": [
    {
      "id": "O1",
      "title": "...",
      "rationale": "...",
      "expected_result": "...",
      "source_areas": ["..."],
      "priority_reason": "..."
    }
  ]
}
`.trim();

  return normalizeProposal(await callObjectiveLLM(prompt));
}

export function formatObjectiveProposal(params: {
  proposal: ObjectiveProposal;
  revised?: boolean;
}) {
  const lines: string[] = [
    params.revised
      ? "Objectifs de résultat — proposition révisée"
      : "Consolidation transversale — objectifs de résultat",
    "",
    "Lecture transversale",
    params.proposal.transversal_reading,
    "",
    "Objectifs proposés",
  ];

  for (const objective of params.proposal.objectives) {
    lines.push(
      "",
      `${objective.id} — ${objective.title}`,
      `Pourquoi : ${objective.rationale}`,
      `Résultat attendu : ${objective.expected_result}`,
      `Priorité : ${objective.priority_reason}`
    );
  }

  lines.push(
    "",
    params.revised
      ? "Cette version vous paraît-elle juste ? Répondez « oui » pour la valider, ou indiquez les dernières corrections à apporter."
      : "Parmi ces objectifs, lesquels considérez-vous comme prioritaires ? Vous pouvez en supprimer, reformuler ou ajouter un. Si cette proposition vous convient telle quelle, répondez « oui »."
  );

  return lines.join("\n");
}
