// lib/reportSchema.ts
export const REPORT_SCHEMA = {
  name: "bilan_sante_dirigeant_v2",
  schema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: ["identification", "synthese", "dimensions", "priorites", "score_global"],
    properties: {
      identification: {
        type: "object",
        additionalProperties: false,
        required: ["entreprise", "dirigeant", "date_rapport", "secteur", "effectif", "ca_annuel"],
        properties: {
          entreprise: { type: "string", minLength: 1, maxLength: 120 },
          dirigeant: { type: "string", minLength: 1, maxLength: 120 },
          date_rapport: { type: "string", minLength: 6, maxLength: 20 },

          // “optionnels métier” => autorisés via null (compat strict)
          secteur: { type: ["string", "null"], maxLength: 120 },
          effectif: { type: ["integer", "null"], minimum: 0 },
          ca_annuel: { type: ["number", "null"], minimum: 0 },
        },
      },

      synthese: {
        type: "object",
        additionalProperties: false,
        required: ["diagnostic_executif", "forces", "risques_cles", "enjeu_majeur"],
        properties: {
          diagnostic_executif: { type: "string", minLength: 40 },
          forces: { type: "array", minItems: 3, maxItems: 5, items: { type: "string" } },
          risques_cles: { type: "array", minItems: 3, maxItems: 5, items: { type: "string" } },
          enjeu_majeur: { type: "string", minLength: 10 },
        },
      },

      dimensions: {
        type: "array",
        minItems: 4,
        maxItems: 4,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["nom", "score", "constats", "causes_racines", "risques", "opportunites", "recommandations"],
          properties: {
            nom: {
              type: "string",
              enum: [
                "Organisation & RH",
                "Commercial & Marchés",
                "Cycle de vente & Prix",
                "Exécution & Performance opérationnelle",
              ],
            },
            score: { type: "integer", minimum: 0, maximum: 100 },
            constats: { type: "array", minItems: 3, maxItems: 5, items: { type: "string" } },
            causes_racines: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } },
            risques: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } },
            opportunites: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } },
            recommandations: { type: "array", minItems: 3, maxItems: 5, items: { type: "string" } },
          },
        },
      },

      priorites: {
        type: "array",
        minItems: 5,
        maxItems: 10,
        items: { type: "string" },
      },

      score_global: {
        type: "object",
        additionalProperties: false,
        required: ["score", "lecture"],
        properties: {
          score: { type: "integer", minimum: 0, maximum: 100 },
          lecture: { type: "string", minLength: 1 },
        },
      },
    },
  },
} as const;