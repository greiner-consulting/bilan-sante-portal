export const CONTEXT_INTAKE_PHASE = "context_intake" as const;

export const CONTEXT_INTAKE_PROMPT = `Nous allons commencer par comprendre l’histoire récente de l’entreprise et l’évolution de ses résultats.

Présentez-moi d’abord, librement, les événements qui ont marqué les trois dernières années : évolution de l’activité, changements importants, difficultés rencontrées, décisions structurantes ou éléments expliquant la trajectoire actuelle.

Ajoutez, pour chacun des trois derniers exercices si vous les avez :
- chiffre d’affaires ou production ;
- marge brute en montant et en % ;
- frais généraux en montant et en % ;
- marge nette.

Vous pouvez répondre sous forme de texte ou de tableau. Si certains éléments ne sont pas disponibles, indiquez-le simplement : nous traiterons explicitement cette absence dans le diagnostic.`;

export const CONTEXT_SOURCE_HEADER =
  "CONTEXTE DIRIGEANT — HISTOIRE ET RESULTATS (source conversationnelle)";

export const DIAGNOSTIC_JOURNEY_STEPS = [
  "Contexte — Histoire & résultats",
  "Organisation & RH",
  "Commercial & Marchés",
  "Cycle de vente & Prix",
  "Exécution & Performance opérationnelle",
  "Objectifs de résultat",
  "Rapport dirigeant",
] as const;
