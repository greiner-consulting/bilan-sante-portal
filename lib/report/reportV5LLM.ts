import OpenAI from "openai";

export type ReportIdentification = {
  entreprise: string;
  dirigeant: string;
  activite: string;
  localisation: string;
  date: string;
};

export type ReportZone = {
  constat: string;
  risque: string;
  consequence: string;
};

export type ReportSwot = {
  forces: string[];
  faiblesses: string[];
  opportunites: string[];
  risques: string[];
};

export type ReportDimension = {
  nom: string;
  score: number;
  constats: string[];
  cause_racine: string;
  zones_non_pilotees: ReportZone[];
  swot: ReportSwot;
};

export type ReportObjective = {
  id: string;
  titre: string;
  objectif_resultat: string;
  owner: string;
  indicateur_cle: string;
  echeance: string;
  gain_potentiel: string;
  statut: "Validé" | "Ajusté" | "Refusé";
  quick_win: string;
  cause_racine: string;
};

export type ReportV5 = {
  identification: ReportIdentification;
  synthese_executive: {
    situation_generale: string;
    constats_structurants: string[];
    zones_critiques: Array<{ zone: string; risque: string }>;
    enjeux_economiques: string[];
    trajectoire_transformation: string;
    message_cle: string;
  };
  historique: {
    synthese_factuelle: string;
    donnees_entree: string[];
  };
  dimensions: ReportDimension[];
  synthese_transverse: Array<{
    constat: string;
    risque: string;
    impact: string;
  }>;
  objectifs: ReportObjective[];
  conclusion: {
    enjeux_actuels: string[];
    impact_potentiel: string;
    coherence_globale: string;
  };
  confidentialite: string;
  checklist: string[];
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const model =
  process.env.OPENAI_MODEL_REPORT ||
  process.env.OPENAI_MODEL_DIAGNOSTIC ||
  process.env.OPENAI_MODEL_CHAT ||
  "gpt-4o";

function clean(value: unknown, max = 5000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanList(value: unknown, max: number, itemMax = 1800) {
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

function normalizeZone(raw: any): ReportZone {
  return {
    constat: clean(raw?.constat, 1200),
    risque: clean(raw?.risque, 1200),
    consequence: clean(raw?.consequence, 1200),
  };
}

function normalizeSwot(raw: any): ReportSwot {
  return {
    forces: cleanList(raw?.forces, 5, 900),
    faiblesses: cleanList(raw?.faiblesses, 5, 900),
    opportunites: cleanList(raw?.opportunites, 5, 900),
    risques: cleanList(raw?.risques, 5, 900),
  };
}

function normalizeReport(raw: any, identification: ReportIdentification): ReportV5 {
  const dimensions = Array.isArray(raw?.dimensions)
    ? raw.dimensions.slice(0, 4).map((d: any) => ({
        nom: clean(d?.nom, 180),
        score: Math.min(5, Math.max(1, Math.round(Number(d?.score ?? 1)))),
        constats: cleanList(d?.constats, 3, 1600),
        cause_racine: clean(d?.cause_racine, 1600),
        zones_non_pilotees: Array.isArray(d?.zones_non_pilotees)
          ? d.zones_non_pilotees.map(normalizeZone).filter((z: ReportZone) => z.constat && z.risque && z.consequence).slice(0, 5)
          : [],
        swot: normalizeSwot(d?.swot),
      }))
    : [];

  if (dimensions.length !== 4 || dimensions.some((d: ReportDimension) => d.constats.length !== 3)) {
    throw new Error("REPORT_DIMENSIONS_CONTRACT_FAILED");
  }

  const objectives = Array.isArray(raw?.objectifs)
    ? raw.objectifs.slice(0, 5).map((o: any, index: number) => ({
        id: clean(o?.id, 40) || `O${index + 1}`,
        titre: clean(o?.titre, 300),
        objectif_resultat: clean(o?.objectif_resultat, 1400),
        owner: clean(o?.owner, 600),
        indicateur_cle: clean(o?.indicateur_cle, 900),
        echeance: clean(o?.echeance, 300),
        gain_potentiel: clean(o?.gain_potentiel, 1400),
        statut: ["Validé", "Ajusté", "Refusé"].includes(String(o?.statut))
          ? (String(o.statut) as ReportObjective["statut"])
          : "Validé",
        quick_win: clean(o?.quick_win, 1200),
        cause_racine: clean(o?.cause_racine, 1200),
      }))
      .filter((o: ReportObjective) => o.titre && o.objectif_resultat)
    : [];

  if (objectives.length < 3) throw new Error("REPORT_OBJECTIVES_CONTRACT_FAILED");

  return {
    identification,
    synthese_executive: {
      situation_generale: clean(raw?.synthese_executive?.situation_generale, 2500),
      constats_structurants: cleanList(raw?.synthese_executive?.constats_structurants, 5, 1400),
      zones_critiques: Array.isArray(raw?.synthese_executive?.zones_critiques)
        ? raw.synthese_executive.zones_critiques
            .map((z: any) => ({ zone: clean(z?.zone, 900), risque: clean(z?.risque, 1000) }))
            .filter((z: any) => z.zone && z.risque)
            .slice(0, 3)
        : [],
      enjeux_economiques: cleanList(raw?.synthese_executive?.enjeux_economiques, 5, 1400),
      trajectoire_transformation: clean(raw?.synthese_executive?.trajectoire_transformation, 1800),
      message_cle: clean(raw?.synthese_executive?.message_cle, 700),
    },
    historique: {
      synthese_factuelle: clean(raw?.historique?.synthese_factuelle, 2500),
      donnees_entree: cleanList(raw?.historique?.donnees_entree, 12, 1000),
    },
    dimensions,
    synthese_transverse: Array.isArray(raw?.synthese_transverse)
      ? raw.synthese_transverse
          .map((x: any) => ({
            constat: clean(x?.constat, 1200),
            risque: clean(x?.risque, 1200),
            impact: clean(x?.impact, 1200),
          }))
          .filter((x: any) => x.constat && x.risque && x.impact)
          .slice(0, 8)
      : [],
    objectifs: objectives,
    conclusion: {
      enjeux_actuels: cleanList(raw?.conclusion?.enjeux_actuels, 6, 1300),
      impact_potentiel: clean(raw?.conclusion?.impact_potentiel, 2600),
      coherence_globale: clean(raw?.conclusion?.coherence_globale, 3500),
    },
    confidentialite:
      clean(raw?.confidentialite, 1600) ||
      "Toute référence au corpus interne est strictement anonymisée. Le rapport ne contient aucune donnée permettant d’identifier une autre entité du corpus interne.",
    checklist: cleanList(raw?.checklist, 12, 700),
  };
}

export async function buildReportV5(params: {
  identification: ReportIdentification;
  diagnosticState: unknown;
}): Promise<ReportV5> {
  const prompt = `
Tu rédiges le livrable final « Bilan de Santé – Rapport Dirigeant » à partir d'un diagnostic DÉJÀ GELÉ ET VALIDÉ.

RÈGLE ABSOLUE DE GEL :
- tu n'introduis aucun fait nouveau ;
- tu n'ouvres aucun nouvel angle d'analyse ;
- tu ne corriges pas le dirigeant ;
- tu structures et hiérarchises uniquement les éléments déjà présents dans l'état diagnostic ;
- les objectifs validés sont traduits en cartes d'objectifs ;
- aucun chiffre précis ne peut être inventé.

QUANTIFICATION :
- utilise uniquement les chiffres présents dans l'état diagnostic ;
- un gain potentiel peut être exprimé en ordre de grandeur ou fourchette seulement si les données permettent un raisonnement explicite ;
- sinon écris clairement « Non quantifiable avec fiabilité à partir des données disponibles » et précise la limite ;
- n'utilise aucun benchmark chiffré externe ou corpus non fourni dans l'entrée.

STRUCTURE IMPÉRATIVE :
1. Identification
2. Synthèse exécutive : situation générale 3-4 phrases, 5 constats maximum, 3 zones critiques maximum, enjeux économiques, trajectoire 12-24 mois, message clé
3. Historique & données d'entrée : synthèse factuelle courte, sans jugement
4. Diagnostic par dimension x4 : Organisation & RH ; Commercial & Marchés ; Cycle de vente & Prix ; Exécution & Performance opérationnelle
   - score de maturité 1 à 5, dérivé uniquement des constats validés
   - exactement 3 constats consolidés
   - une cause racine dominante
   - zones non pilotées : constat + risque + conséquence
   - SWOT 4 à 5 éléments maximum par case
5. Synthèse transverse des zones non pilotées : 5 à 8 points
6. Plan d'actions : 3 à 5 objectifs de résultat validés ; pour chaque carte : owner, indicateur, échéance, gain potentiel, statut, quick win, cause racine
7. Conclusion dirigeant : enjeux actuels, impact potentiel 12-24 mois, cohérence globale entre les 4 dimensions avec alignements, désalignements et contradictions
8. Confidentialité
9. Checklist de conformité

Important : la séquence historique n'est PAS une cinquième dimension et ne reçoit aucun score.

IDENTIFICATION FOURNIE PAR LE DIRIGEANT :
${JSON.stringify(params.identification, null, 2)}

ÉTAT DIAGNOSTIC GELÉ :
${JSON.stringify(params.diagnosticState, null, 2)}

Retourne STRICTEMENT du JSON valide de cette forme :
{
  "synthese_executive": {
    "situation_generale": "...",
    "constats_structurants": ["..."],
    "zones_critiques": [{"zone":"...","risque":"..."}],
    "enjeux_economiques": ["..."],
    "trajectoire_transformation": "...",
    "message_cle": "..."
  },
  "historique": {"synthese_factuelle":"...","donnees_entree":["..."]},
  "dimensions": [
    {
      "nom":"Organisation & RH",
      "score":2,
      "constats":["...","...","..."],
      "cause_racine":"...",
      "zones_non_pilotees":[{"constat":"...","risque":"...","consequence":"..."}],
      "swot":{"forces":["..."],"faiblesses":["..."],"opportunites":["..."],"risques":["..."]}
    }
  ],
  "synthese_transverse":[{"constat":"...","risque":"...","impact":"..."}],
  "objectifs":[{
    "id":"O1","titre":"...","objectif_resultat":"...","owner":"...","indicateur_cle":"...","echeance":"...","gain_potentiel":"...","statut":"Validé","quick_win":"...","cause_racine":"..."
  }],
  "conclusion":{"enjeux_actuels":["..."],"impact_potentiel":"...","coherence_globale":"..."},
  "confidentialite":"...",
  "checklist":["..."]
}
`.trim();

  const response = await openai.chat.completions.create({
    model,
    temperature: 0.12,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Tu es un consultant senior chargé de la restitution finale d'un diagnostic opérationnel gelé. Tu n'ajoutes aucun fait et tu produis uniquement un JSON conforme au format demandé.",
      },
      { role: "user", content: prompt },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  return normalizeReport(JSON.parse(raw), params.identification);
}
