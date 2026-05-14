import OpenAI from "openai";

/*
 * factExtractorLLM.ts
 *
 * Extraction analytique de faits diagnostiques depuis une trame.
 *
 * Objectif :
 * - arrêter d'extraire des thèmes génériques ;
 * - extraire des faits précis, chiffrés, sourcés, questionnables ;
 * - produire une matière directement exploitable pour les questions LLM ;
 * - préserver la compatibilité avec l'interface existante ExtractedFact.
 */

export interface DimensionSpec {
  id: number;
  name: string;
  investigationGoals: string[];
  allowedThemes: string[];
  forbiddenThemes: string[];
  confusionRisks: string[];
}

export interface ExtractedFact {
  theme: string;
  raw_signal: string;
  managerial_risk: string;
  recommended_entry_angle: string;
  signal_kind: string;
  instruction_goal: string;
  proof_level: number;
  confidence_score: number;
  criticality_score: number;

  /**
   * Champs enrichis facultatifs.
   * Ils ne cassent pas les appels existants, mais permettent au pipeline aval
   * de poser des questions beaucoup plus ancrées.
   */
  diagnostic_statement?: string;
  source_excerpt?: string;
  numeric_values?: Record<string, number | string>;
  suggested_questions?: string[];
  missing_angles?: string[];
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
] as const;

const ALLOWED_GOALS = [
  "verify",
  "quantify",
  "explain_cause",
  "test_arbitration",
  "measure_impact",
] as const;

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeString(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAngle(value: unknown) {
  const x = normalizeString(value).toLowerCase();

  if ((ALLOWED_ANGLES as readonly string[]).includes(x)) return x;

  if (x.includes("exemple") || x.includes("cas")) return "example";
  if (x.includes("ordre") || x.includes("quant") || x.includes("combien")) {
    return "magnitude";
  }
  if (x.includes("mécan") || x.includes("mecan") || x.includes("fonction")) {
    return "mechanism";
  }
  if (x.includes("cause") || x.includes("pourquoi")) return "causality";
  if (x.includes("dépend") || x.includes("depend")) return "dependency";
  if (x.includes("arbitr")) return "arbitration";
  if (x.includes("formal")) return "formalization";
  if (x.includes("transition") || x.includes("bascule")) return "transition";
  if (x.includes("économ") || x.includes("econom") || x.includes("marge")) {
    return "economics";
  }
  if (x.includes("fréquence") || x.includes("frequence") || x.includes("souvent")) {
    return "frequency";
  }
  if (x.includes("rex") || x.includes("retour")) return "feedback";

  return "mechanism";
}

function normalizeGoal(value: unknown) {
  const x = normalizeString(value).toLowerCase();
  if ((ALLOWED_GOALS as readonly string[]).includes(x)) return x;
  if (x.includes("quant")) return "quantify";
  if (x.includes("cause")) return "explain_cause";
  if (x.includes("arbitr")) return "test_arbitration";
  if (x.includes("impact") || x.includes("mesure") || x.includes("marge")) {
    return "measure_impact";
  }
  return "verify";
}

function splitDocument(document: string, maxChunkLength = 14000): string[] {
  const text = String(document || "").replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const sections = text
    .split(/\n(?=\s*(?:\d+(?:\.\d+)*[-.)]|\d+\s*[-–—]|[A-ZÉÈÀÙÂÊÎÔÛÇ][^\n]{0,80}:))/g)
    .map((x) => x.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  for (const section of sections.length > 0 ? sections : [text]) {
    if ((current + "\n\n" + section).length <= maxChunkLength) {
      current = current ? `${current}\n\n${section}` : section;
      continue;
    }

    if (current) chunks.push(current);

    if (section.length <= maxChunkLength) {
      current = section;
    } else {
      for (let i = 0; i < section.length; i += maxChunkLength) {
        chunks.push(section.slice(i, i + maxChunkLength));
      }
      current = "";
    }
  }

  if (current) chunks.push(current);

  return chunks.slice(0, 6);
}

function isWeakFact(fact: ExtractedFact) {
  const raw = normalizeString(fact.raw_signal).toLowerCase();
  const statement = normalizeString(fact.diagnostic_statement).toLowerCase();
  const source = normalizeString(fact.source_excerpt).toLowerCase();

  const combined = `${raw} ${statement} ${source}`.trim();

  if (!combined) return true;

  const genericMarkers = [
    "ressources vs charge",
    "clarté des rôles",
    "clarte des roles",
    "recrutement et intégration",
    "recrutement et integration",
    "turnover absentéisme stabilité",
    "turnover absenteisme stabilite",
    "organisation et rh",
    "commercial et marchés",
    "commercial et marches",
    "cycle de vente",
    "exécution et performance",
    "execution et performance",
  ];

  if (genericMarkers.includes(raw)) return true;

  if (raw.length < 25 && !/\d/.test(raw)) return true;

  return false;
}

function factKey(fact: ExtractedFact) {
  return normalizeString(
    `${fact.theme} ${fact.raw_signal} ${fact.source_excerpt}`
  )
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 240);
}

function dedupeFacts(facts: ExtractedFact[], max = 12): ExtractedFact[] {
  const seen = new Set<string>();
  const out: ExtractedFact[] = [];

  const sorted = [...facts].sort((a, b) => {
    const scoreA =
      Number(a.criticality_score || 0) +
      Number(a.confidence_score || 0) +
      (a.numeric_values && Object.keys(a.numeric_values).length > 0 ? 20 : 0);
    const scoreB =
      Number(b.criticality_score || 0) +
      Number(b.confidence_score || 0) +
      (b.numeric_values && Object.keys(b.numeric_values).length > 0 ? 20 : 0);
    return scoreB - scoreA;
  });

  for (const fact of sorted) {
    if (isWeakFact(fact)) continue;

    const key = factKey(fact);
    if (!key || seen.has(key)) continue;

    seen.add(key);
    out.push(fact);

    if (out.length >= max) break;
  }

  return out;
}

function normalizeFact(rawFact: any): ExtractedFact {
  const numericValues =
    rawFact?.numeric_values && typeof rawFact.numeric_values === "object"
      ? rawFact.numeric_values
      : {};

  const suggestedQuestions = Array.isArray(rawFact?.suggested_questions)
    ? rawFact.suggested_questions.map(normalizeString).filter(Boolean).slice(0, 4)
    : [];

  const missingAngles = Array.isArray(rawFact?.missing_angles)
    ? rawFact.missing_angles
        .map((x: unknown) => normalizeAngle(x))
        .filter(Boolean)
        .slice(0, 6)
    : [];

  const recommendedAngle = normalizeAngle(rawFact?.recommended_entry_angle);

  return {
    theme: normalizeString(rawFact?.theme),
    raw_signal: normalizeString(rawFact?.raw_signal),
    managerial_risk: normalizeString(rawFact?.managerial_risk),
    recommended_entry_angle: recommendedAngle,
    signal_kind: normalizeString(rawFact?.signal_kind),
    instruction_goal: normalizeGoal(rawFact?.instruction_goal),
    proof_level: clampNumber(rawFact?.proof_level, 1, 5, 3),
    confidence_score: clampNumber(rawFact?.confidence_score, 0, 100, 55),
    criticality_score: clampNumber(rawFact?.criticality_score, 0, 100, 65),

    diagnostic_statement: normalizeString(rawFact?.diagnostic_statement),
    source_excerpt: normalizeString(rawFact?.source_excerpt),
    numeric_values: numericValues,
    suggested_questions: suggestedQuestions,
    missing_angles: missingAngles.length > 0 ? missingAngles : undefined,
  };
}

function buildPrompt(params: {
  chunk: string;
  dimension: DimensionSpec;
  chunkIndex: number;
  chunkCount: number;
}) {
  const { chunk, dimension, chunkIndex, chunkCount } = params;

  return `
Tu es un consultant senior en diagnostic stratégique et redressement de PME.

Tu dois lire un extrait de trame et extraire des FAITS DIAGNOSTIQUES PRECIS pour la dimension :
${dimension.id} — ${dimension.name}

Tu ne dois pas produire des thèmes génériques.
Tu dois extraire des faits questionnables, ancrés dans la trame, avec leur citation source.

Un fait diagnostique exploitable doit être :
- concret ;
- lié à un passage précis du document ;
- si possible chiffré ;
- utile pour poser une question de diagnostic au dirigeant ;
- formulé comme un constat métier, pas comme une catégorie.

Exemples de bons faits :
- "Fin mars, le retard de facturation atteint 425 K€, ce qui peut traduire un décalage de facturation ou une marge prévisionnelle surévaluée."
- "Environ 400 K€ de main-d’œuvre ne seraient pas imputés sur les affaires, dont 150 K€ restent à identifier."
- "La réunion hebdomadaire de planning part des effectifs disponibles et non des besoins par chantier."
- "Le chef d’agence suit encore directement SNCF, GSK, les chiffrages photovoltaïques et une partie du pilotage DET."
- "Le fichier commercial ne suit pas la marge, alors qu’il suit les affaires gagnées, perdues et abandonnées."

Exemples de mauvais faits interdits :
- "ressources vs charge"
- "clarté des rôles"
- "recrutement et intégration"
- "pilotage commercial"
- "organisation RH"
- "qualité et adéquation des équipes"

Réponds STRICTEMENT en JSON :

{
  "facts": [
    {
      "theme": "string",
      "raw_signal": "phrase factuelle précise issue de la trame",
      "diagnostic_statement": "constat diagnostic clair, complet, sans ellipse",
      "source_excerpt": "court extrait exact ou quasi exact de la trame qui justifie le fait",
      "numeric_values": {
        "nom_indicateur": "valeur"
      },
      "managerial_risk": "risque concret si le fait n'est pas maîtrisé",
      "recommended_entry_angle": "example|magnitude|mechanism|causality|dependency|arbitration|formalization|transition|economics|frequency|feedback",
      "missing_angles": ["mechanism", "causality"],
      "suggested_questions": [
        "question précise, ancrée dans le fait extrait"
      ],
      "signal_kind": "label_metier_court",
      "instruction_goal": "verify|quantify|explain_cause|test_arbitration|measure_impact",
      "proof_level": 1,
      "confidence_score": 0,
      "criticality_score": 0
    }
  ]
}

REGLES IMPERATIVES :
- Extrais entre 4 et 10 faits pour cet extrait si la matière existe.
- Ne crée aucun fait qui ne soit pas justifié par source_excerpt.
- Si un chiffre existe, il doit apparaître dans raw_signal ou numeric_values.
- source_excerpt doit être court, mais suffisamment explicite.
- diagnostic_statement doit être une phrase terminée.
- managerial_risk doit être spécifique, pas générique.
- suggested_questions doit contenir des questions directement utilisables en entretien.
- theme doit rester dans les thèmes autorisés quand c'est possible.
- Ne conserve pas les titres de rubrique comme faits.
- Ne confonds pas la dimension demandée avec les autres dimensions.
- Aucun texte hors JSON.

OBJECTIFS D'ENQUETE
${dimension.investigationGoals.map((x) => `- ${x}`).join("\n")}

THEMES AUTORISES
${dimension.allowedThemes.map((x) => `- ${x}`).join("\n")}

THEMES INTERDITS
${dimension.forbiddenThemes.map((x) => `- ${x}`).join("\n")}

RISQUES DE CONFUSION A EVITER
${dimension.confusionRisks.map((x) => `- ${x}`).join("\n")}

EXTRAIT ${chunkIndex + 1}/${chunkCount} :
${chunk}
`.trim();
}

/**
 * Extrait des faits structurés depuis la trame pour une dimension.
 */
export async function extractFactsFromText(params: {
  document: string;
  dimension: DimensionSpec;
}): Promise<ExtractedFact[]> {
  const { document, dimension } = params;
  const chunks = splitDocument(document);

  if (chunks.length === 0) return [];

  const allFacts: ExtractedFact[] = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const prompt = buildPrompt({
      chunk: chunks[i],
      dimension,
      chunkIndex: i,
      chunkCount: chunks.length,
    });

    try {
      const resp = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL_CHAT || "gpt-4o-mini",
        temperature: 0.02,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Consultant senior en diagnostic de PME. Tu extrais uniquement des faits diagnostiques précis, sourcés, questionnables. JSON uniquement.",
          },
          { role: "user", content: prompt },
        ],
      });

      const raw = resp.choices[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(raw);
      const facts = Array.isArray(parsed?.facts) ? parsed.facts : [];

      allFacts.push(...facts.map(normalizeFact));
    } catch {
      continue;
    }
  }

  return dedupeFacts(allFacts, 14);
}