export type IntakeColumn = {
  key: string;
  label: string;
  kind: "text" | "number";
  unit?: string;
  placeholder?: string;
};

export type IntakeTable = {
  key: string;
  title: string;
  description?: string;
  columns: IntakeColumn[];
  rows: Array<Record<string, string>>;
};

export type IntakeField = {
  key: string;
  label: string;
  kind: "text" | "number";
  unit?: string;
  placeholder?: string;
};

export type StructuredIntakeSchema = {
  area: "context" | "rh" | "commercial" | "pricing" | "execution";
  title: string;
  instructions: string;
  note?: string;
  tables: IntakeTable[];
  fields?: IntakeField[];
};

export type StructuredIntakeData = {
  tables: Record<string, Array<Record<string, string>>>;
  fields: Record<string, string>;
};

const yearRows = () => [
  { exercice: "N-2" },
  { exercice: "N-1" },
  { exercice: "N" },
];

const blankRows = (count: number) =>
  Array.from({ length: count }, () => ({} as Record<string, string>));

export const STRUCTURED_INTAKE_SCHEMAS: Record<string, StructuredIntakeSchema> = {
  context: {
    area: "context",
    title: "Résultats des trois derniers exercices",
    instructions:
      "Commençons par les chiffres. Renseignez les données disponibles pour les trois derniers exercices. Laissez une cellule vide si l'information n'est pas disponible : l'IA distinguera une donnée absente d'une valeur nulle.",
    note:
      "Montants en k€. Pour les pourcentages, saisissez par exemple 12,5 pour 12,5 %. Vous pouvez remplacer N-2, N-1 et N par les années réelles.",
    tables: [
      {
        key: "results_3years",
        title: "Production et résultat",
        columns: [
          { key: "exercice", label: "Exercice", kind: "text", placeholder: "2024" },
          { key: "production", label: "Production / CA", kind: "number", unit: "k€" },
          { key: "marge_brute", label: "Marge brute", kind: "number", unit: "k€" },
          { key: "marge_brute_pct", label: "Marge brute", kind: "number", unit: "%" },
          { key: "frais_generaux", label: "Frais généraux", kind: "number", unit: "k€" },
          { key: "frais_generaux_pct", label: "Frais généraux", kind: "number", unit: "%" },
          { key: "marge_nette", label: "Marge nette", kind: "number", unit: "k€" },
        ],
        rows: yearRows(),
      },
    ],
  },

  rh: {
    area: "rh",
    title: "Indicateurs RH",
    instructions:
      "Renseignez d'abord les indicateurs RH disponibles. L'objectif est de disposer d'une base chiffrée fiable avant d'interpréter l'organisation et les mouvements d'effectifs.",
    note:
      "Si l'ancienneté ou le turnover ne sont pas fiables, laissez la valeur vide : vous pourrez l'expliquer ensuite dans le dialogue.",
    tables: [
      {
        key: "rh_3years",
        title: "Effectifs et mouvements sur trois exercices",
        columns: [
          { key: "exercice", label: "Exercice", kind: "text" },
          { key: "effectif_total", label: "Effectif total", kind: "number" },
          { key: "cadres", label: "Cadres", kind: "number" },
          { key: "etam_employes", label: "ETAM / employés", kind: "number" },
          { key: "ouvriers", label: "Ouvriers", kind: "number" },
          { key: "anciennete_moyenne", label: "Ancienneté moy.", kind: "number", unit: "ans" },
          { key: "turnover_pct", label: "Turnover", kind: "number", unit: "%" },
          { key: "demissions", label: "Démissions", kind: "number" },
        ],
        rows: yearRows(),
      },
    ],
  },

  commercial: {
    area: "commercial",
    title: "Top 10 clients",
    instructions:
      "Renseignez les dix principaux clients sur la période de référence disponible. L'objectif est de mesurer à la fois le poids commercial et la contribution à la marge.",
    note:
      "Utilisez la même période de référence pour tous les clients. Si vous n'avez que le chiffre d'affaires ou la production sans la marge, renseignez uniquement la donnée disponible.",
    tables: [
      {
        key: "top_clients",
        title: "Top 10 clients — activité et marge",
        columns: [
          { key: "client", label: "Client", kind: "text" },
          { key: "production", label: "Production / CA", kind: "number", unit: "k€" },
          { key: "marge", label: "Marge", kind: "number", unit: "k€" },
          { key: "marge_pct", label: "Marge", kind: "number", unit: "%" },
          { key: "part_activite_pct", label: "Part activité", kind: "number", unit: "%" },
        ],
        rows: blankRows(10),
      },
    ],
  },

  pricing: {
    area: "pricing",
    title: "Funnel commercial et carnet",
    instructions:
      "Renseignez le funnel commercial avec les montants et les marges disponibles. Cette photographie servira ensuite à discuter du cycle de vente, du chiffrage et de la politique de prix.",
    note:
      "Les lignes correspondent aux quatre niveaux de maturité attendus. Ne déplacez pas une affaire d'un stade à l'autre pour compléter le tableau : utilisez votre définition réelle du funnel.",
    tables: [
      {
        key: "sales_funnel",
        title: "Funnel",
        columns: [
          { key: "stage", label: "Stade", kind: "text" },
          { key: "nombre", label: "Nb affaires", kind: "number" },
          { key: "montant", label: "Montant", kind: "number", unit: "k€" },
          { key: "marge_pct", label: "Marge moyenne", kind: "number", unit: "%" },
        ],
        rows: [
          { stage: "Projets identifiés" },
          { stage: "Devis en chiffrage" },
          { stage: "Devis remis" },
          { stage: "Carnet de commandes" },
        ],
      },
    ],
    fields: [
      {
        key: "cycle_vente_moyen",
        label: "Durée moyenne du cycle de vente",
        kind: "number",
        unit: "jours",
        placeholder: "ex. 90",
      },
    ],
  },

  execution: {
    area: "execution",
    title: "Contribution à la marge et indicateurs d'exécution",
    instructions:
      "Renseignez les affaires ou clients qui contribuent le plus à la marge et ceux qui la pénalisent le plus. Complétez les indicateurs sécurité et clients lorsqu'ils sont suivis.",
    note:
      "Une marge négative peut être saisie avec un signe moins. Pour le Flop 10, classez de préférence les pertes les plus importantes en premier.",
    tables: [
      {
        key: "top_margin",
        title: "Top 10 — plus forts contributeurs à la marge",
        columns: [
          { key: "client_affaire", label: "Client / affaire", kind: "text" },
          { key: "production", label: "Production / CA", kind: "number", unit: "k€" },
          { key: "marge", label: "Marge", kind: "number", unit: "k€" },
          { key: "marge_pct", label: "Marge", kind: "number", unit: "%" },
        ],
        rows: blankRows(10),
      },
      {
        key: "flop_margin",
        title: "Flop 10 — plus forts pénalisants pour la marge",
        columns: [
          { key: "client_affaire", label: "Client / affaire", kind: "text" },
          { key: "production", label: "Production / CA", kind: "number", unit: "k€" },
          { key: "marge", label: "Marge / perte", kind: "number", unit: "k€" },
          { key: "marge_pct", label: "Marge", kind: "number", unit: "%" },
        ],
        rows: blankRows(10),
      },
    ],
    fields: [
      { key: "tf1", label: "TF1", kind: "number" },
      { key: "tg", label: "TG", kind: "number" },
      { key: "accidents_12m", label: "Accidents avec arrêt sur 12 mois", kind: "number" },
      { key: "reclamations_12m", label: "Réclamations clients sur 12 mois", kind: "number" },
    ],
  },
};

export const AREA_NARRATIVE_PROMPTS: Record<string, string> = {
  context: `Merci. Nous avons maintenant la base chiffrée.

Que s’est-il passé ? Quelle est votre histoire sur ces trois dernières années ?

Expliquez-moi les événements, décisions, changements d’organisation, affaires marquantes ou difficultés qui permettent de comprendre la trajectoire des résultats. Ne cherchez pas à tout analyser : racontez d’abord les faits tels que vous les avez vécus.`,

  rh: `Merci. Les indicateurs RH donnent une première photographie.

Que s’est-il passé dans les équipes sur cette période ?

Expliquez les principaux mouvements, recrutements, départs, réorganisations, difficultés de management ou de compétences, ainsi que les postes que vous considérez aujourd’hui comme critiques ou fragiles.`,

  commercial: `Merci. Nous avons maintenant la structure chiffrée du portefeuille clients.

Comment cette situation commerciale s’est-elle construite ?

Expliquez les évolutions récentes du portefeuille, les clients gagnés ou perdus, les marchés que vous souhaitez développer et les axes de développement existants. S’il n’existe pas de stratégie commerciale formalisée, dites-le simplement.`,

  pricing: `Merci. Le funnel donne une photographie de la dynamique commerciale.

Comment fonctionne réellement votre cycle de vente et votre politique de prix ?

Expliquez comment les affaires sont détectées et qualifiées, comment les devis sont construits, qui fixe ou valide les marges, comment se déroule la négociation et dans quels cas vous décidez de ne pas répondre.`,

  execution: `Merci. Nous avons maintenant une première lecture chiffrée de la contribution des affaires à la marge.

Qu’est-ce qui explique ces écarts de performance ?

Décrivez les causes que vous identifiez, la manière dont les affaires sont pilotées, les écarts entre marge vendue et marge réalisée, les sujets de satisfaction clients et de sécurité, ainsi que les principaux rituels de management opérationnel.`,
};

export function emptyStructuredData(schema: StructuredIntakeSchema): StructuredIntakeData {
  const tables: Record<string, Array<Record<string, string>>> = {};
  for (const table of schema.tables) {
    tables[table.key] = table.rows.map((row) => ({ ...row }));
  }
  const fields: Record<string, string> = {};
  for (const field of schema.fields || []) fields[field.key] = "";
  return { tables, fields };
}

export function sanitizeStructuredData(
  schema: StructuredIntakeSchema,
  raw: unknown
): StructuredIntakeData {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as any) : {};
  const tables: Record<string, Array<Record<string, string>>> = {};

  for (const table of schema.tables) {
    const incoming = Array.isArray(source?.tables?.[table.key])
      ? source.tables[table.key]
      : [];
    const maxRows = Math.max(table.rows.length, incoming.length);
    const rows: Array<Record<string, string>> = [];

    for (let i = 0; i < maxRows; i += 1) {
      const baseRow = table.rows[i] || {};
      const incomingRow = incoming[i] && typeof incoming[i] === "object" ? incoming[i] : {};
      const row: Record<string, string> = {};
      for (const column of table.columns) {
        const value = String(incomingRow[column.key] ?? baseRow[column.key] ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 160);
        row[column.key] = value;
      }
      rows.push(row);
    }
    tables[table.key] = rows;
  }

  const fields: Record<string, string> = {};
  for (const field of schema.fields || []) {
    fields[field.key] = String(source?.fields?.[field.key] ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
  }

  return { tables, fields };
}

export function structuredDataHasContent(data: StructuredIntakeData) {
  if (Object.values(data.fields).some((value) => value.trim())) return true;
  return Object.values(data.tables).some((rows) =>
    rows.some((row) => Object.values(row).some((value) => value.trim()))
  );
}
