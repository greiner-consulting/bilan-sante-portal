import type {
  CoverageState,
  DiagnosticFact,
  FactBackedQuestion,
  FactDimension,
  InstructionGoal,
  QuestionCandidate,
  SignalAngle,
} from "@/lib/diagnostic/types";
import {
  convertCandidateToStructuredQuestion,
  inferDisplayModeFromFact,
  normalizeTheme,
  normalizeText,
} from "@/lib/diagnostic/types";
import {
  DIMENSION_GUARDRAILS,
  clampDimension,
  expectedQuestionCount,
  type IterationMode,
} from "@/lib/diagnostic/diagnosticContracts";
import {
  buildRiskFromFact,
  fallbackFactsFromThemes,
  factUsableForQuestion,
  hashQuestion,
  refreshDimensionMemory,
  selectFactsForIteration,
} from "@/lib/diagnostic/diagnosticState";
import {
  extractFactsFromText,
  type ExtractedFact,
} from "@/lib/diagnostic/factExtractorLLM";

const DEBUG_DIAGNOSTIC = true;

function debugLog(scope: string, payload: Record<string, unknown>) {
  if (!DEBUG_DIAGNOSTIC) return;
  console.log(`[diagnostic][${scope}]`, JSON.stringify(payload, null, 2));
}

type BatchPlannedItem = {
  fact_id: string;
  theme: string;
  intended_angle: SignalAngle;
  planner_rationale: string;
};

type RhPatternId =
  | "founder_centralization"
  | "role_blur"
  | "weak_managerial_line"
  | "critical_skill_dependency"
  | "recruitment_unstructured"
  | "social_tension"
  | "ritual_gap"
  | "structure_misalignment"
  | "generic_rh";

function limitUniqueStrings(values: string[], max = 8): string[] {
  const out: string[] = [];
  for (const value of values) {
    const x = String(value || "").trim();
    if (!x) continue;
    if (!out.includes(x)) out.push(x);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeSignalAngle(value: string): SignalAngle | null {
  const x = normalizeText(value);

  if (x === "example" || x === "cas" || x === "illustration") return "example";
  if (x === "magnitude" || x === "quantification" || x === "ordre de grandeur") {
    return "magnitude";
  }
  if (x === "mechanism" || x === "mecanisme") return "mechanism";
  if (x === "causality" || x === "cause" || x === "causalite") return "causality";
  if (x === "dependency" || x === "dependance") return "dependency";
  if (x === "arbitration" || x === "arbitrage") return "arbitration";
  if (x === "formalization" || x === "formalisme") return "formalization";
  if (x === "transition") return "transition";
  if (x === "economics" || x === "economic" || x === "economique") {
    return "economics";
  }
  if (x === "frequency" || x === "frequence") return "frequency";
  if (x === "feedback" || x === "rex" || x === "retour d experience") {
    return "feedback";
  }

  return null;
}

function desiredAnglesForIteration(
  iteration: number,
  mode: IterationMode
): SignalAngle[] {
  if (mode === "reopen_after_no") {
    return ["mechanism", "dependency", "arbitration"];
  }

  if (iteration === 1) {
    return [
      "mechanism",
      "formalization",
      "dependency",
      "frequency",
      "magnitude",
      "example",
    ];
  }

  if (iteration === 2) {
    return ["dependency", "arbitration", "causality", "mechanism", "economics"];
  }

  return ["causality", "arbitration", "transition", "feedback", "economics"];
}

function getFactTagValue(fact: DiagnosticFact, prefix: string): string | null {
  for (const tag of fact.tags ?? []) {
    const normalizedTag = String(tag || "").trim();
    if (!normalizedTag.startsWith(prefix)) continue;
    return normalizedTag.slice(prefix.length).trim() || null;
  }
  return null;
}

function getPreferredEntryAngleFromFact(fact: DiagnosticFact): SignalAngle | null {
  const value = getFactTagValue(fact, "entry_angle:");
  if (!value) return null;
  return normalizeSignalAngle(value);
}

function getSignalKindFromFact(fact: DiagnosticFact): string | null {
  return getFactTagValue(fact, "signal_kind:");
}

function getRawSignalFromFact(fact: DiagnosticFact): string {
  return (
    getFactTagValue(fact, "diagnostic_statement:") ||
    getFactTagValue(fact, "raw_signal:") ||
    fact.observed_element ||
    fact.theme ||
    ""
  ).trim();
}

function getSuggestedQuestionsFromFact(fact: DiagnosticFact): string[] {
  const rawFact = fact as any;
  if (!Array.isArray(rawFact.suggested_questions)) return [];
  return rawFact.suggested_questions.map(String).filter(Boolean).slice(0, 5);
}

function hasNumericValues(fact: DiagnosticFact): boolean {
  return Boolean(
    fact.numeric_values &&
      typeof fact.numeric_values === "object" &&
      Object.keys(fact.numeric_values).length > 0
  );
}

function normalizeNumericValues(value: unknown): Record<string, number | string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

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

  return out;
}

function isDimensionOneThemeAllowed(theme: string): boolean {
  const allowed = DIMENSION_GUARDRAILS[1].allowedThemes.map(normalizeTheme);
  return allowed.includes(normalizeTheme(theme));
}

function looksCommercialOrEconomic(text: string): boolean {
  const x = normalizeText(text);

  const bannedMarkers = [
    "client",
    "clients",
    "portefeuille",
    "pipeline",
    "prospection",
    "conversion",
    "offres",
    "offre",
    "devis",
    "chiffrage",
    "ciblage commercial",
    "strategie commerciale",
    "action commerciale",
    "marge",
    "rentabilite",
    "rentabilité",
    "prix",
    "tarification",
    "negociation",
    "négociation",
    "positionnement marche",
    "marché",
    "marche",
  ];

  return bannedMarkers.some((marker) => x.includes(normalizeText(marker)));
}

function isDimensionOneFactReallyRh(fact: DiagnosticFact): boolean {
  const themeOk = isDimensionOneThemeAllowed(fact.theme);
  if (!themeOk) return false;

  const signalKind = normalizeText(getSignalKindFromFact(fact) || "");
  const rawSignal = getRawSignalFromFact(fact);
  const observed = fact.observed_element || "";
  const risk = fact.managerial_risk || "";
  const text = `${rawSignal} | ${observed} | ${risk}`;

  const forbiddenSignalKinds = [
    "commercial_method_gap",
    "strategy_formalization_gap",
    "client_dependency",
    "pricing_issue",
    "economic_loss",
    "pipeline_fragility",
    "commercial_dependency",
  ];

  if (forbiddenSignalKinds.includes(signalKind)) return false;
  if (looksCommercialOrEconomic(text)) return false;

  return true;
}

function filterFactsForDimension(
  facts: DiagnosticFact[],
  dimension: number
): DiagnosticFact[] {
  if (dimension !== 1) return facts;
  return facts.filter(isDimensionOneFactReallyRh);
}

function classifyRhPattern(fact: DiagnosticFact): RhPatternId {
  const theme = normalizeTheme(fact.theme);
  const signalKind = normalizeText(getSignalKindFromFact(fact) || "");
  const rawSignal = normalizeText(getRawSignalFromFact(fact));
  const observed = normalizeText(fact.observed_element || "");
  const all = `${theme} | ${signalKind} | ${rawSignal} | ${observed}`;

  if (
    signalKind.includes("centralization") ||
    signalKind.includes("founder_dependency") ||
    all.includes("dirigeant") ||
    all.includes("remonte") ||
    all.includes("revient au dirigeant") ||
    all.includes("trop centralise") ||
    theme.includes("gouvernance") ||
    theme.includes("autonomie encadrement")
  ) {
    return "founder_centralization";
  }

  if (
    signalKind.includes("role_blur") ||
    signalKind.includes("ambiguity") ||
    theme.includes("roles et responsabilites") ||
    all.includes("zone grise") ||
    all.includes("chevauchement") ||
    all.includes("responsabilites floues")
  ) {
    return "role_blur";
  }

  if (
    signalKind.includes("managerial_fragility") ||
    theme.includes("ligne manageriale") ||
    theme.includes("relais d encadrement") ||
    theme.includes("management de proximite") ||
    theme.includes("capacite d execution manageriale")
  ) {
    return "weak_managerial_line";
  }

  if (
    signalKind.includes("critical_skill") ||
    signalKind.includes("dependency") ||
    theme.includes("competences critiques") ||
    theme.includes("dependances humaines")
  ) {
    return "critical_skill_dependency";
  }

  if (
    signalKind.includes("recruitment") ||
    theme.includes("recrutement") ||
    theme.includes("remplacement de profils inadaptes")
  ) {
    return "recruitment_unstructured";
  }

  if (
    signalKind.includes("social") ||
    signalKind.includes("adhesion") ||
    theme.includes("climat social") ||
    theme.includes("adhesion des equipes")
  ) {
    return "social_tension";
  }

  if (
    signalKind.includes("ritual") ||
    signalKind.includes("pilotage") ||
    theme.includes("rituels manageriaux") ||
    theme.includes("structure de pilotage")
  ) {
    return "ritual_gap";
  }

  if (
    signalKind.includes("dimensioning") ||
    signalKind.includes("structure") ||
    theme.includes("organisation interne") ||
    theme.includes("dimensionnement structure")
  ) {
    return "structure_misalignment";
  }

  return "generic_rh";
}

function buildRhInterviewEntry(
  fact: DiagnosticFact,
  pattern: RhPatternId,
  angle: SignalAngle,
  iteration: number
): string {
  const raw = getRawSignalFromFact(fact);

  switch (pattern) {
    case "founder_centralization":
      if (iteration === 1) {
        return "ce qui remonte encore au dirigeant alors que cela devrait être traité plus bas";
      }
      if (angle === "dependency") {
        return "la dépendance de l'organisation à l'intervention directe du dirigeant";
      }
      if (angle === "arbitration") {
        return "qui tranche réellement quand l'encadrement n'absorbe pas le sujet";
      }
      return "la centralisation réelle du pilotage";

    case "role_blur":
      if (iteration === 1) return "les zones grises entre responsables et équipes";
      if (angle === "arbitration") {
        return "qui décide réellement quand les rôles se chevauchent";
      }
      return "la clarté réelle des rôles et responsabilités";

    case "weak_managerial_line":
      if (iteration === 1) return "la capacité réelle de la ligne managériale à tenir le terrain";
      if (angle === "dependency") {
        return "ce que l'encadrement ne tient pas sans appui individuel fort";
      }
      return "la robustesse réelle de la ligne managériale";

    case "critical_skill_dependency":
      if (iteration === 1) {
        return "les savoir-faire ou décisions qui reposent sur trop peu de personnes";
      }
      return "la dépendance à des personnes clés";

    case "recruitment_unstructured":
      if (iteration === 1) {
        return "la manière réelle de définir un besoin et de sécuriser un recrutement";
      }
      return "la solidité du pilotage recrutement";

    case "social_tension":
      if (iteration === 1) {
        return "ce qui crée concrètement de la tension ou de la distance dans les équipes";
      }
      return "les ressorts réels du climat social et de l'adhésion";

    case "ritual_gap":
      if (iteration === 1) {
        return "ce qui est réellement piloté par des rituels stables ou laissé aux usages";
      }
      return "la tenue réelle des rituels de management et de pilotage";

    case "structure_misalignment":
      if (iteration === 1) {
        return "l'adéquation réelle entre la structure, la charge et le mode de pilotage";
      }
      return "les limites de structuration qui freinent l'exécution";

    default:
      return raw || fact.observed_element || fact.theme;
  }
}

function buildRhQuestionText(params: {
  fact: DiagnosticFact;
  angle: SignalAngle;
  iteration: number;
}): string {
  const { fact, angle, iteration } = params;
  const pattern = classifyRhPattern(fact);
  const raw = getRawSignalFromFact(fact);

  switch (pattern) {
    case "founder_centralization":
      if (iteration === 1) {
        if (angle === "mechanism") {
          return "Aujourd'hui, qu'est-ce qui remonte encore chez vous dans l'opérationnel ou le management alors que cela devrait être traité plus bas ?";
        }
        if (angle === "formalization") {
          return "Entre vous et vos responsables, qu'est-ce qui est clairement délégué aujourd'hui, et qu'est-ce qui revient encore chez vous dans les faits ?";
        }
        if (angle === "dependency") {
          return "Sur quels sujets savez-vous que l'entreprise tient encore surtout parce que vous êtes personnellement dans la boucle ?";
        }
        if (angle === "frequency") {
          return "Sur une semaine normale, à quelle fréquence devez-vous reprendre vous-même des sujets censés être traités par l'encadrement ?";
        }
        if (angle === "magnitude") {
          return "En ordre de grandeur, quelle part de votre temps prend encore ce type de reprise aujourd'hui ?";
        }
        return "Pouvez-vous me raconter un cas récent où vous avez dû reprendre un sujet qui aurait dû être traité par un responsable ?";
      }

      if (angle === "dependency") {
        return "Qu'est-ce qui ne tiendrait pas vraiment aujourd'hui si vous vous retiriez quelques jours d'un sujet sensible ou d'une zone de management ?";
      }
      if (angle === "arbitration") {
        return "Quand un sujet se tend, qui tranche réellement aujourd'hui : vous, un responsable identifié, ou le sujet remonte sans arbitre clair ?";
      }
      if (angle === "causality") {
        return "Ce qui explique surtout cette centralisation aujourd'hui, c'est plutôt un problème de niveau managérial, de rôle mal défini, d'habitude historique, ou autre chose ?";
      }
      if (angle === "economics") {
        return "Quel impact concret cette reprise par le dirigeant a-t-elle aujourd'hui sur la vitesse de décision, la charge, ou la capacité à faire tourner l'entreprise ?";
      }
      return "Qu'est-ce qui bloquerait concrètement une baisse durable de votre intervention directe sur ces sujets ?";

    case "role_blur":
      if (iteration === 1) {
        if (angle === "mechanism") {
          return "Entre vos responsables, sur quels sujets voyez-vous encore des recouvrements ou des zones grises dans le fonctionnement réel ?";
        }
        if (angle === "formalization") {
          return "Aujourd'hui, qu'est-ce qui est vraiment clair noir sur blanc sur les rôles, et qu'est-ce qui reste géré par habitude ou ajustement ?";
        }
        if (angle === "dependency") {
          return "Quand les rôles ne sont pas clairs, sur qui repose la remise en ordre dans la pratique ?";
        }
        if (angle === "frequency") {
          return "À quelle fréquence ces zones grises créent-elles des reprises, des doublons ou des non-décisions ?";
        }
        return "Pouvez-vous me décrire un cas récent où deux personnes pensaient ne pas porter exactement la même responsabilité ?";
      }

      if (angle === "arbitration") {
        return "Quand les rôles se chevauchent ou qu'un sujet n'a pas de propriétaire clair, qui décide réellement aujourd'hui ?";
      }
      if (angle === "dependency") {
        return "Sans telle ou telle personne de référence, où voyez-vous que les sujets restent sans porteur clair ?";
      }
      if (angle === "causality") {
        return "La cause principale de ces zones grises, c'est plutôt une organisation trop floue, une croissance non accompagnée, ou un défaut d'arbitrage managérial ?";
      }
      if (angle === "economics") {
        return "Concrètement, ces chevauchements ou vides de responsabilité coûtent quoi aujourd'hui en temps, coordination ou qualité d'exécution ?";
      }
      return "Qu'est-ce qu'il faudrait clarifier en premier pour que ces sujets cessent de flotter entre plusieurs personnes ?";

    case "weak_managerial_line":
      if (iteration === 1) {
        if (angle === "mechanism") {
          return "Quand un dossier se tend, qu'une équipe décroche ou qu'un point doit être recadré, qui reprend réellement la main aujourd'hui ?";
        }
        if (angle === "formalization") {
          return "Qu'attendez-vous précisément de vos responsables aujourd'hui, et où voyez-vous encore un écart entre le rôle attendu et le rôle réellement tenu ?";
        }
        if (angle === "dependency") {
          return "Dans la ligne managériale, sur quels sujets cela tient encore surtout grâce à quelques personnes plus qu'à un cadre de fonctionnement solide ?";
        }
        if (angle === "frequency") {
          return "À quelle fréquence devez-vous reprendre un sujet de management ou de coordination qui aurait dû être absorbé par la ligne managériale ?";
        }
        if (angle === "magnitude") {
          return "En ordre de grandeur, combien de responsables ou de relais voyez-vous aujourd'hui réellement autonomes sur leur périmètre ?";
        }
        return "Pouvez-vous me raconter un cas récent où l'encadrement n'a pas absorbé une difficulté comme vous l'auriez attendu ?";
      }

      if (angle === "dependency") {
        return "Aujourd'hui, qu'est-ce que la ligne managériale ne tient pas encore sans appui direct du dirigeant ou de quelques profils très solides ?";
      }
      if (angle === "arbitration") {
        return "Quand il faut recadrer, prioriser ou trancher un sujet sensible, qui le fait réellement aujourd'hui dans la ligne managériale ?";
      }
      if (angle === "causality") {
        return "Ce qui explique surtout la fragilité de la ligne managériale aujourd'hui, c'est plutôt le niveau des personnes, le flou de rôle, la surcharge, ou l'absence de cadre commun ?";
      }
      if (angle === "economics") {
        return "Quel impact concret cette fragilité de l'encadrement a-t-elle sur votre charge, la coordination ou la tenue des engagements ?";
      }
      return "Qu'est-ce qui empêcherait aujourd'hui votre ligne managériale de franchir un vrai cap d'autonomie ?";

    case "critical_skill_dependency":
      if (iteration === 1) {
        if (angle === "mechanism") {
          return "Sur quels savoir-faire, décisions ou relations savez-vous qu'un départ ou une absence créerait tout de suite un trou ?";
        }
        if (angle === "formalization") {
          return "Qu'est-ce qui est réellement transmis, documenté ou doublonné sur ces compétences clés, et qu'est-ce qui reste dans la tête de quelques personnes ?";
        }
        if (angle === "dependency") {
          return "Aujourd'hui, quels sujets reposent encore sur un nombre très limité de personnes ?";
        }
        if (angle === "frequency") {
          return "À quelle fréquence voyez-vous des situations où l'entreprise se retrouve ralentie faute de la bonne personne au bon endroit ?";
        }
        if (angle === "magnitude") {
          return "En ordre de grandeur, sur combien de postes ou compétences clés avez-vous ce type de dépendance forte aujourd'hui ?";
        }
        return "Pouvez-vous me citer un cas récent où l'absence d'une personne a fragilisé la continuité ?";
      }

      if (angle === "dependency") {
        return "Sans ces personnes clés, qu'est-ce qui ne tournerait pas normalement aujourd'hui : décision, relation client, expertise, coordination, autre ?";
      }
      if (angle === "causality") {
        return "Cette dépendance vient surtout d'un manque de transmission, d'un défaut de doublure, d'une difficulté de recrutement, ou d'une organisation qui concentre trop ?";
      }
      if (angle === "arbitration") {
        return "Quand vous devez protéger ou redéployer une compétence clé, qui arbitre et sur quels critères ?";
      }
      if (angle === "economics") {
        return "Concrètement, cette dépendance pèse comment aujourd'hui sur la productivité, les délais ou la qualité d'exécution ?";
      }
      return "Qu'est-ce qui bloquerait aujourd'hui une vraie sécurisation de ces compétences critiques ?";

    case "recruitment_unstructured":
      if (iteration === 1) {
        if (angle === "mechanism") {
          return "Quand vous décidez de recruter un encadrant ou un profil clé, comment le besoin se construit-il réellement aujourd'hui ?";
        }
        if (angle === "formalization") {
          return "Qu'est-ce qui est vraiment structuré aujourd'hui dans le recrutement : définition du besoin, évaluation, validation, intégration ?";
        }
        if (angle === "dependency") {
          return "Le recrutement repose aujourd'hui surtout sur un besoin objectivé, ou plutôt sur une opportunité, une urgence ou l'intuition de quelques personnes ?";
        }
        if (angle === "frequency") {
          return "À quelle fréquence vous retrouvez-vous à recruter dans l'urgence ou avec un besoin encore mal verrouillé ?";
        }
        if (angle === "magnitude") {
          return "Sur les derniers recrutements sensibles, quelle part diriez-vous avoir été décidée sous contrainte ou dans l'urgence ?";
        }
        return "Pouvez-vous me raconter le dernier recrutement un peu structurant, de la définition du besoin jusqu'à la décision ?";
      }

      if (angle === "dependency") {
        return "Aujourd'hui, le bon recrutement tient surtout à une méthode stable, ou à la qualité de jugement de quelques personnes clés ?";
      }
      if (angle === "causality") {
        return "Ce qui explique surtout les décalages de recrutement, c'est plutôt l'urgence, un besoin mal défini, un processus faible, ou une difficulté d'attractivité ?";
      }
      if (angle === "arbitration") {
        return "Quand un profil est moyen mais que le besoin est pressant, qui tranche réellement aujourd'hui ?";
      }
      if (angle === "economics") {
        return "Quel coût concret voyez-vous quand un recrutement est mal cadré : temps perdu, intégration ratée, turnover, reprise managériale ?";
      }
      return "Qu'est-ce qu'il faudrait fiabiliser en premier pour que vos recrutements structurants soient moins aléatoires ?";

    case "social_tension":
      if (iteration === 1) {
        if (angle === "mechanism") {
          return "Aujourd'hui, dans quelles situations concrètes voyez-vous apparaître de la tension, de la distance ou une faible adhésion des équipes ?";
        }
        if (angle === "formalization") {
          return "Qu'est-ce qui est réellement posé aujourd'hui pour faire passer les décisions, traiter les irritants et garder les équipes embarquées ?";
        }
        if (angle === "dependency") {
          return "L'adhésion des équipes tient aujourd'hui surtout à un cadre collectif solide, ou à quelques personnes qui savent faire tenir le système ?";
        }
        if (angle === "frequency") {
          return "À quelle fréquence voyez-vous revenir ces signaux de tension ou de décrochage ?";
        }
        return "Pouvez-vous me décrire un épisode récent où vous avez senti que l'équipe n'adhérait pas vraiment ou commençait à se tendre ?";
      }

      if (angle === "causality") {
        return "Ce qui alimente surtout cette tension aujourd'hui, c'est plutôt le manque de clarté, la surcharge, l'encadrement, des décisions mal expliquées, ou autre chose ?";
      }
      if (angle === "dependency") {
        return "Sans quelques personnes qui font tampon ou expliquent les choses, qu'est-ce qui se tendrait tout de suite davantage ?";
      }
      if (angle === "arbitration") {
        return "Quand une tension remonte, qui la traite réellement aujourd'hui et avec quelle marge de manœuvre ?";
      }
      if (angle === "economics") {
        return "Quel impact concret ce climat a-t-il aujourd'hui sur l'engagement, la stabilité des équipes ou la qualité d'exécution ?";
      }
      return "Qu'est-ce qui devrait changer en priorité pour que l'adhésion repose moins sur l'énergie individuelle et davantage sur un cadre solide ?";

    case "ritual_gap":
      if (iteration === 1) {
        if (angle === "mechanism") {
          return "Quels sont aujourd'hui les vrais rendez-vous de pilotage ou de management qui font tenir le système, et quels sujets restent encore gérés au fil de l'eau ?";
        }
        if (angle === "formalization") {
          return "Parmi vos rituels de management ou de pilotage, qu'est-ce qui est réellement tenu avec régularité et qu'est-ce qui reste très dépendant des personnes ?";
        }
        if (angle === "dependency") {
          return "Quand un rituel n'a pas lieu ou se relâche, qu'est-ce qui se dérègle tout de suite dans le fonctionnement ?";
        }
        if (angle === "frequency") {
          return "À quelle fréquence ces rituels sautent-ils, se déforment-ils ou perdent-ils leur utilité concrète ?";
        }
        return "Pouvez-vous me décrire un rituel managérial ou de pilotage qui existe sur le papier mais qui, dans la pratique, ne produit pas vraiment l'effet attendu ?";
      }

      if (angle === "dependency") {
        return "Aujourd'hui, la tenue de ces rituels repose surtout sur un cadre stable, ou sur la volonté de quelques personnes ?";
      }
      if (angle === "arbitration") {
        return "Quand un sujet n'est pas tranché dans les circuits prévus, où finit-il par être arbitré réellement ?";
      }
      if (angle === "causality") {
        return "Si ces rituels ne jouent pas pleinement leur rôle, est-ce surtout un problème de discipline, de contenu, de niveau managérial, ou de surcharge ?";
      }
      if (angle === "economics") {
        return "Concrètement, l'absence ou la faiblesse de ces rituels coûte quoi aujourd'hui en coordination, temps ou reprises ?";
      }
      return "Qu'est-ce qu'il faudrait verrouiller pour que ces rituels deviennent un vrai appui de pilotage et non une simple habitude ?";

    case "structure_misalignment":
      if (iteration === 1) {
        if (angle === "mechanism") {
          return "Quand vous regardez la structure actuelle, où voyez-vous qu'elle colle mal à la charge réelle ou au mode de fonctionnement de l'entreprise ?";
        }
        if (angle === "formalization") {
          return "Qu'est-ce qui est réellement pensé aujourd'hui dans l'organisation, et qu'est-ce qui s'est ajouté par empilement au fil du temps ?";
        }
        if (angle === "dependency") {
          return "Quels points de fonctionnement tiennent encore surtout grâce à des compensations individuelles parce que la structure n'absorbe pas correctement la charge ?";
        }
        if (angle === "frequency") {
          return "À quelle fréquence voyez-vous la structure actuelle générer des reprises, des engorgements ou des zones mal tenues ?";
        }
        if (angle === "magnitude") {
          return "En ordre de grandeur, où situez-vous aujourd'hui le principal décalage : trop de charge, pas assez d'encadrement, mauvaise répartition, autre ?";
        }
        return "Pouvez-vous me citer un cas récent où la structure actuelle a clairement montré ses limites dans le fonctionnement quotidien ?";
      }

      if (angle === "dependency") {
        return "Aujourd'hui, quelles limites de structure se voient surtout parce que quelques personnes compensent ce que l'organisation n'absorbe pas ?";
      }
      if (angle === "arbitration") {
        return "Quand il faut arbitrer une évolution d'organisation ou de dimensionnement, qui le fait réellement aujourd'hui et sur quels critères ?";
      }
      if (angle === "causality") {
        return "La limite principale de structure vient surtout d'un sous-dimensionnement, d'un mauvais découpage des rôles, d'un pilotage trop centralisé, ou d'un empilement historique ?";
      }
      if (angle === "economics") {
        return "Quel impact concret voyez-vous aujourd'hui de cette structure sur la charge du dirigeant, la vitesse d'exécution ou la tenue des engagements ?";
      }
      return "Qu'est-ce qui bloquerait aujourd'hui une organisation plus lisible et plus robuste ?";

    default:
      if (iteration === 1) {
        if (angle === "mechanism") {
          return `Sur ce point, qu'est-ce qui se passe concrètement aujourd'hui dans le fonctionnement réel : ${raw} ?`;
        }
        if (angle === "formalization") {
          return `Qu'est-ce qui est réellement cadré aujourd'hui sur ce sujet, et qu'est-ce qui repose encore surtout sur les usages : ${raw} ?`;
        }
        if (angle === "dependency") {
          return `Sur ce point, qu'est-ce qui dépend encore trop de quelques personnes dans la pratique : ${raw} ?`;
        }
        if (angle === "frequency") {
          return `À quelle fréquence cette situation se présente-t-elle réellement aujourd'hui : ${raw} ?`;
        }
        if (angle === "magnitude") {
          return `Quel ordre de grandeur pouvez-vous donner sur ce point aujourd'hui : ${raw} ?`;
        }
        return `Pouvez-vous me raconter un cas récent qui illustre ce point dans le fonctionnement réel : ${raw} ?`;
      }

      if (angle === "dependency") {
        return `Sur ce sujet, qu'est-ce qui tient encore surtout par quelques personnes plutôt que par l'organisation elle-même : ${raw} ?`;
      }
      if (angle === "arbitration") {
        return `Quand ce point crée une difficulté concrète, qui tranche réellement aujourd'hui : ${raw} ?`;
      }
      if (angle === "causality") {
        return `Qu'est-ce qui explique surtout ce point aujourd'hui, dans la pratique : ${raw} ?`;
      }
      if (angle === "economics") {
        return `Quel impact concret ce point a-t-il aujourd'hui sur la charge, la coordination ou la tenue des engagements : ${raw} ?`;
      }
      return `Qu'est-ce qui empêcherait aujourd'hui de sécuriser durablement ce point : ${raw} ?`;
  }
}

function buildGenericQuestionText(params: {
  fact: DiagnosticFact;
  angle: SignalAngle;
  iteration: number;
}): string {
  const { fact, angle } = params;
  const suggestedQuestions = getSuggestedQuestionsFromFact(fact);

  if (suggestedQuestions.length > 0) {
    const candidate = suggestedQuestions.find((q) => {
      const normalized = normalizeText(q);
      return (
        normalized.length >= 25 &&
        !normalized.includes("point le moins maitrise")
      );
    });

    if (candidate) return candidate;
  }

  const raw = getRawSignalFromFact(fact);

  switch (angle) {
    case "example":
      return `Pouvez-vous me citer un cas récent qui illustre concrètement ce point : ${raw} ?`;
    case "magnitude":
      return `Sur ce point, quel ordre de grandeur pouvez-vous donner aujourd'hui : ${raw} ?`;
    case "mechanism":
      return `Concrètement, comment cela se passe-t-il dans la pratique sur ce sujet : ${raw} ?`;
    case "causality":
      return `Qu'est-ce qui explique surtout cette situation aujourd'hui : ${raw} ?`;
    case "dependency":
      return `Cette situation dépend-elle encore trop de quelques personnes, dossiers ou habitudes : ${raw} ?`;
    case "arbitration":
      return `Quand ce point bloque ou dévie, qui tranche réellement aujourd'hui : ${raw} ?`;
    case "formalization":
      return `Qu'est-ce qui est réellement formalisé sur ce sujet, et qu'est-ce qui reste géré au cas par cas : ${raw} ?`;
    case "transition":
      return `Qu'est-ce qui bloquerait aujourd'hui un fonctionnement plus robuste sur ce point : ${raw} ?`;
    case "economics":
      return `Quel impact concret voyez-vous aujourd'hui de ce point sur la performance ou la charge : ${raw} ?`;
    case "frequency":
      return `À quelle fréquence ce sujet se présente-t-il réellement : ${raw} ?`;
    case "feedback":
      return `Quand ce type de situation se produit, comment capitalisez-vous concrètement dessus : ${raw} ?`;
    default:
      return `Pouvez-vous me décrire concrètement ce point dans le fonctionnement réel : ${raw} ?`;
  }
}

function shouldAvoidExampleAngle(
  fact: DiagnosticFact,
  iteration: number,
  mode: IterationMode
): boolean {
  if (mode === "reopen_after_no") return true;
  if (iteration >= 2) return true;
  if ((fact.asked_angles ?? []).includes("example")) return true;

  const preferred = getPreferredEntryAngleFromFact(fact);
  if (preferred && preferred !== "example") return true;

  return false;
}

function shouldAvoidMagnitudeAngle(
  fact: DiagnosticFact,
  iteration: number
): boolean {
  if (iteration <= 1) return false;
  if ((fact.asked_angles ?? []).includes("magnitude")) return true;
  if (fact.progress === "quantified") return true;

  const raw = normalizeText(getRawSignalFromFact(fact));
  if (/\b\d+\b/.test(raw)) return true;
  if (raw.includes("%") || raw.includes("pourcent")) return true;

  return false;
}

function shouldAvoidCausalityAngle(
  fact: DiagnosticFact,
  iteration: number
): boolean {
  if (iteration <= 1) return true;
  if (
    fact.progress === "causalized" ||
    fact.progress === "arbitrated" ||
    fact.progress === "stabilized" ||
    fact.progress === "consolidated"
  ) {
    return true;
  }
  return false;
}

function pickBestAngleForFact(
  fact: DiagnosticFact,
  iteration: number,
  mode: IterationMode
): SignalAngle {
  const desired = desiredAnglesForIteration(iteration, mode);
  const missing = fact.missing_angles ?? [];
  const asked = fact.asked_angles ?? [];
  const preferred = getPreferredEntryAngleFromFact(fact);

  const avoidExample = shouldAvoidExampleAngle(fact, iteration, mode);
  const avoidMagnitude =
    !hasNumericValues(fact) && shouldAvoidMagnitudeAngle(fact, iteration);
  const avoidCausality = shouldAvoidCausalityAngle(fact, iteration);

  function allowed(angle: SignalAngle) {
    if (avoidExample && angle === "example") return false;
    if (avoidMagnitude && angle === "magnitude") return false;
    if (avoidCausality && angle === "causality") return false;
    return true;
  }

  if (iteration === 1 && preferred && allowed(preferred)) {
    return preferred;
  }

  for (const angle of desired) {
    if (!allowed(angle)) continue;
    if (missing.includes(angle)) return angle;
  }

  for (const angle of missing) {
    if (!allowed(angle)) continue;
    if (!asked.includes(angle)) return angle;
  }

  for (const angle of desired) {
    if (!allowed(angle)) continue;
    if (!asked.includes(angle)) return angle;
  }

  return desired.find(allowed) ?? "mechanism";
}

function buildPlannerRationale(
  fact: DiagnosticFact,
  angle: SignalAngle,
  iteration: number,
  mode: IterationMode
): string {
  const progress = fact.progress ?? "identified";
  const signalKind = getSignalKindFromFact(fact);
  const base = `itération ${iteration}, angle ${angle}, progression ${progress}${
    signalKind ? `, signal ${signalKind}` : ""
  }`;

  const reasonByAngle: Record<SignalAngle, string> = {
    example: "ancrer le point dans un cas vécu",
    magnitude: "obtenir un ordre de grandeur utile",
    mechanism: "faire décrire le fonctionnement réel",
    causality: "faire émerger la cause dominante",
    dependency: "tester la dépendance à quelques personnes ou relais",
    arbitration: "faire apparaître qui décide réellement",
    formalization: "distinguer cadre posé et usages réels",
    transition: "tester ce qui bloque une bascule durable",
    economics: "relier le point à ses effets concrets",
    frequency: "mesurer la récurrence du sujet",
    feedback: "tester la capacité d'apprentissage",
  };

  if (mode === "reopen_after_no") {
    return `${base} — relance ciblée : ${reasonByAngle[angle]}.`;
  }

  return `${base} — objectif : ${reasonByAngle[angle]}.`;
}

function buildQuestionAnchorFromFact(
  fact: DiagnosticFact,
  angle: SignalAngle,
  iteration: number
): string {
  if (fact.dimension_primary === 1) {
    return buildRhInterviewEntry(fact, classifyRhPattern(fact), angle, iteration);
  }
  return getRawSignalFromFact(fact);
}

function buildQuestionText(params: {
  fact: DiagnosticFact;
  angle: SignalAngle;
  iteration: number;
}): string {
  const { fact, angle, iteration } = params;

  if (fact.dimension_primary === 1) {
    return buildRhQuestionText({ fact, angle, iteration });
  }

  return buildGenericQuestionText({ fact, angle, iteration });
}

function buildQuestionCandidateFromPlan(
  fact: DiagnosticFact,
  angle: SignalAngle,
  plannerRationale: string,
  iteration: number
): QuestionCandidate {
  const anchor = buildQuestionAnchorFromFact(fact, angle, iteration);

  return {
    fact_id: fact.id,
    theme: fact.theme,
    display_mode: inferDisplayModeFromFact(fact),
    anchor,
    hypothesis: fact.prudent_hypothesis,
    managerial_risk: buildRiskFromFact(fact),
    question: buildQuestionText({
      fact,
      angle,
      iteration,
    }),
    intended_angle: angle,
    planner_rationale: plannerRationale,
  };
}

function inferInstructionGoalFromAngle(angle: SignalAngle): InstructionGoal {
  if (angle === "magnitude" || angle === "economics" || angle === "frequency") {
    return "measure_impact";
  }
  if (angle === "causality" || angle === "mechanism" || angle === "dependency") {
    return "explain_cause";
  }
  if (angle === "arbitration") {
    return "test_arbitration";
  }
  return "verify";
}

function factTypeForDimensionLocal(
  dimension: number
): "organisational_fact" | "commercial_fact" | "economic_fact" | "operational_fact" {
  if (dimension === 1) return "organisational_fact";
  if (dimension === 2) return "commercial_fact";
  if (dimension === 3) return "economic_fact";
  return "operational_fact";
}

function allowedStatementModeFromProofLevel(
  proofLevel: number
): "fact_only" | "prudent_hypothesis" | "validated_finding" {
  if (proofLevel >= 4) return "validated_finding";
  if (proofLevel === 3) return "prudent_hypothesis";
  return "fact_only";
}

function normalizeInstructionGoal(value: string, angle: SignalAngle): InstructionGoal {
  if (
    value === "quantify" ||
    value === "verify" ||
    value === "explain_cause" ||
    value === "test_arbitration" ||
    value === "measure_impact"
  ) {
    return value as InstructionGoal;
  }

  return inferInstructionGoalFromAngle(angle);
}

function buildTagsFromExtractedFact(fact: ExtractedFact, angle: SignalAngle) {
  return limitUniqueStrings(
    [
      normalizeTheme(fact.theme),
      fact.raw_signal ? `raw_signal:${fact.raw_signal.slice(0, 700)}` : "",
      fact.diagnostic_statement
        ? `diagnostic_statement:${fact.diagnostic_statement.slice(0, 700)}`
        : "",
      fact.signal_kind ? `signal_kind:${fact.signal_kind}` : "",
      angle ? `entry_angle:${angle}` : "",
    ],
    20
  );
}

function convertExtractedFactToDiagnosticFact(params: {
  extracted: ExtractedFact;
  dimension: number;
  index: number;
}): DiagnosticFact | null {
  const { extracted, dimension, index } = params;
  const d = clampDimension(dimension);

  const recommendedEntryAngle =
    normalizeSignalAngle(String(extracted.recommended_entry_angle ?? "").trim()) ??
    "mechanism";

  const proofLevel = Math.min(
    5,
    Math.max(1, Number(extracted.proof_level ?? 3))
  ) as 1 | 2 | 3 | 4 | 5;

  const rawSignal = String(extracted.raw_signal ?? "").replace(/\s+/g, " ").trim();
  const diagnosticStatement = String(
    extracted.diagnostic_statement || extracted.raw_signal || ""
  )
    .replace(/\s+/g, " ")
    .trim();

  const sourceExcerpt = String(extracted.source_excerpt || rawSignal)
    .replace(/\s+/g, " ")
    .trim();

  const suggestedQuestions = Array.isArray(extracted.suggested_questions)
    ? extracted.suggested_questions.map(String).filter(Boolean).slice(0, 5)
    : [];

  const missingAngles = Array.isArray(extracted.missing_angles)
    ? (extracted.missing_angles
        .map((a) => normalizeSignalAngle(String(a)))
        .filter(Boolean) as SignalAngle[])
    : [];

  const fact: DiagnosticFact = {
    id: `seed-d${d}-${index + 1}`,
    dimension_primary: d as FactDimension,
    dimension_secondary: [],
    fact_type: factTypeForDimensionLocal(d),
    theme: String(extracted.theme || "").trim(),
    observed_element: diagnosticStatement || rawSignal,
    source: "trame",
    source_excerpt: sourceExcerpt,
    numeric_values: normalizeNumericValues(extracted.numeric_values),
    tags: buildTagsFromExtractedFact(extracted, recommendedEntryAngle),
    evidence_kind: sourceExcerpt || hasNumericValuesLike(extracted.numeric_values)
      ? "explicit_fact"
      : "weak_signal",
    proof_level: proofLevel,
    reasoning_status: "to_instruct",
    prudent_hypothesis:
      proofLevel <= 2
        ? `Le point "${String(extracted.theme || "").trim()}" nécessite encore une validation plus concrète.`
        : undefined,
    managerial_risk: String(extracted.managerial_risk || "").trim() || undefined,
    instruction_goal: normalizeInstructionGoal(
      String(extracted.instruction_goal || ""),
      recommendedEntryAngle
    ),
    allowed_statement_mode: allowedStatementModeFromProofLevel(proofLevel),
    confidence_score: Math.max(
      0,
      Math.min(100, Number(extracted.confidence_score ?? 55))
    ),
    criticality_score: Math.max(
      0,
      Math.min(100, Number(extracted.criticality_score ?? 65))
    ),
    asked_count: 0,
    last_question_at: undefined,
    evidence_refs: [],
    contradiction_notes: [],
    progress: "identified",
    asked_angles: [],
    
    missing_angles:
      missingAngles.length > 0
    ? limitUniqueSignals(missingAngles, 6)
    : limitUniqueSignals(
        [
          recommendedEntryAngle,
          "mechanism",
          "causality",
          "economics",
        ] as SignalAngle[],
        6
      ),
    last_planned_angle: undefined,
    first_seen_iteration: 1,
    last_completed_iteration: undefined,
    linked_fact_ids: [],
    previous_questions: [],
    previous_answers: [],
    answer_summaries: [],
    validated_findings: [],
    open_hypotheses: [],
    next_question_hints: [],
  };

  (fact as any).diagnostic_statement = diagnosticStatement;
  (fact as any).raw_signal = rawSignal;
  (fact as any).suggested_questions = suggestedQuestions;

  if (!fact.id || !fact.theme || !fact.observed_element) return null;

  return fact;
}

function hasNumericValuesLike(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value as Record<string, unknown>).length > 0;
}

function limitUniqueSignals(values: SignalAngle[], max = 6): SignalAngle[] {
  const out: SignalAngle[] = [];
  for (const value of values) {
    if (!out.includes(value)) out.push(value);
    if (out.length >= max) break;
  }
  return out;
}


async function extractInitialFactsForDimension(
  extractedText: string,
  dimension: number
): Promise<DiagnosticFact[]> {
  const d = clampDimension(dimension);
  const guard = DIMENSION_GUARDRAILS[d];

  try {
    const extractedFacts = await extractFactsFromText({
      document: extractedText,
      dimension: {
        id: d,
        name: guard.name,
        investigationGoals: guard.investigationGoals,
        allowedThemes: guard.allowedThemes,
        forbiddenThemes: guard.forbiddenThemes,
        confusionRisks: guard.confusionRisks,
      },
    });

    const normalizedFacts = extractedFacts
      .map((fact, index) =>
        convertExtractedFactToDiagnosticFact({
          extracted: fact,
          dimension: d,
          index,
        })
      )
      .filter(Boolean) as DiagnosticFact[];

    const usableFacts = normalizedFacts.filter(factUsableForQuestion);
    const dimensionFacts = filterFactsForDimension(usableFacts, d);

    debugLog("extractInitialFactsForDimension", {
      dimension: d,
      extracted: extractedFacts.length,
      normalized: normalizedFacts.length,
      usable: usableFacts.length,
      dimensionFacts: dimensionFacts.length,
      sample: dimensionFacts.slice(0, 5).map((fact) => ({
        id: fact.id,
        theme: fact.theme,
        observed_element: fact.observed_element,
        source_excerpt: fact.source_excerpt,
        numeric_values: fact.numeric_values,
        criticality_score: fact.criticality_score,
      })),
    });

    return dimensionFacts;
  } catch (error: any) {
    debugLog("extractInitialFactsForDimension_error", {
      dimension: d,
      error: error?.message ?? String(error),
    });
    return [];
  }
}

export async function ensureFactInventory(
  coverage: CoverageState,
  extractedText: string
): Promise<CoverageState> {
  if (Array.isArray(coverage.fact_inventory) && coverage.fact_inventory.length > 0) {
    return coverage;
  }

  const allFacts: DiagnosticFact[] = [];

  for (const dimension of [1, 2, 3, 4] as const) {
    const extracted = await extractInitialFactsForDimension(extractedText, dimension);

    if (extracted.length > 0) {
      allFacts.push(...extracted);
    } else {
      allFacts.push(...fallbackFactsFromThemes(dimension, extractedText));
    }
  }

  debugLog("ensureFactInventory", {
    totalFacts: allFacts.length,
    byDimension: [1, 2, 3, 4].map((dimension) => ({
      dimension,
      count: allFacts.filter((fact) => fact.dimension_primary === dimension).length,
    })),
    sample: allFacts.slice(0, 8).map((fact) => ({
      id: fact.id,
      dimension: fact.dimension_primary,
      theme: fact.theme,
      observed_element: fact.observed_element,
      numeric_values: fact.numeric_values,
      criticality_score: fact.criticality_score,
    })),
  });

  return {
    ...coverage,
    fact_inventory: allFacts,
  };
}

function buildBatchPlan(params: {
  coverage: CoverageState;
  extractedText: string;
  dimension: number;
  iteration: number;
  mode: IterationMode;
}): {
  facts: DiagnosticFact[];
  plan: BatchPlannedItem[];
} {
  const { coverage, extractedText, dimension, iteration, mode } = params;
  const count = expectedQuestionCount(iteration, mode);

  let facts = selectFactsForIteration(coverage, dimension, iteration, mode);
  facts = filterFactsForDimension(facts, dimension);

  if (facts.length === 0) {
    facts = filterFactsForDimension(
      fallbackFactsFromThemes(dimension, extractedText),
      dimension
    );
  }

  const selectedFacts = facts.slice(0, count);

  const plan: BatchPlannedItem[] = selectedFacts.map((fact) => {
    const angle = pickBestAngleForFact(fact, iteration, mode);
    return {
      fact_id: fact.id,
      theme: fact.theme,
      intended_angle: angle,
      planner_rationale: buildPlannerRationale(fact, angle, iteration, mode),
    };
  });

  return {
    facts: selectedFacts,
    plan,
  };
}

function generateQuestionCandidatesFromPlan(params: {
  facts: DiagnosticFact[];
  plan: BatchPlannedItem[];
  iteration: number;
}): QuestionCandidate[] {
  const { facts, plan, iteration } = params;
  const factsById = new Map(facts.map((f) => [f.id, f]));

  return plan
    .map((item) => {
      const fact = factsById.get(item.fact_id);
      if (!fact) return null;
      return buildQuestionCandidateFromPlan(
        fact,
        item.intended_angle,
        item.planner_rationale,
        iteration
      );
    })
    .filter(Boolean) as QuestionCandidate[];
}

function deduplicateQuestions(questions: FactBackedQuestion[]): FactBackedQuestion[] {
  const seen = new Set<string>();
  const result: FactBackedQuestion[] = [];

  for (const q of questions) {
    const h = hashQuestion(q);
    if (seen.has(h)) continue;
    seen.add(h);
    result.push(q);
  }

  return result;
}

function enforceMinimumQuestions(
  questions: FactBackedQuestion[],
  facts: DiagnosticFact[],
  plan: BatchPlannedItem[],
  minimum: number,
  iteration: number
): FactBackedQuestion[] {
  if (questions.length >= minimum) {
    return questions.slice(0, minimum);
  }

  const factsById = new Map(facts.map((f) => [f.id, f]));
  const usedFactIds = new Set(questions.map((q) => q.fact_id));
  const fallback: FactBackedQuestion[] = [];

  for (const item of plan) {
    if (questions.length + fallback.length >= minimum) break;
    if (usedFactIds.has(item.fact_id)) continue;

    const fact = factsById.get(item.fact_id);
    if (!fact) continue;

    fallback.push(
      convertCandidateToStructuredQuestion(
        buildQuestionCandidateFromPlan(
          fact,
          item.intended_angle,
          item.planner_rationale,
          iteration
        )
      )
    );
  }

  return [...questions, ...fallback].slice(0, minimum);
}

function buildQuestionBatchCodeOnly(params: {
  coverage: CoverageState;
  extractedText: string;
  dimension: number;
  iteration: number;
  mode: IterationMode;
}): FactBackedQuestion[] {
  const { coverage, extractedText, dimension, iteration, mode } = params;

  const { facts, plan } = buildBatchPlan({
    coverage,
    extractedText,
    dimension,
    iteration,
    mode,
  });

  const candidates = generateQuestionCandidatesFromPlan({
    facts,
    plan,
    iteration,
  });

  const structured = candidates.map((candidate) =>
    convertCandidateToStructuredQuestion({
      ...candidate,
      managerial_risk: candidate.managerial_risk,
    })
  );

  const unique = deduplicateQuestions(structured);

  return enforceMinimumQuestions(
    unique,
    facts,
    plan,
    expectedQuestionCount(iteration, mode),
    iteration
  );
}

export async function buildQuestionBatch(params: {
  extractedText: string;
  coverage: CoverageState;
  dimension: number;
  iteration: number;
  history: string;
  mode?: IterationMode;
}): Promise<FactBackedQuestion[]> {
  const {
    extractedText,
    coverage,
    dimension,
    iteration,
    mode = "normal",
  } = params;

  const refreshed = refreshDimensionMemory(coverage, dimension);

  const codeBatch = buildQuestionBatchCodeOnly({
    coverage: refreshed,
    extractedText,
    dimension,
    iteration,
    mode,
  });

  debugLog("buildQuestionBatch_source", {
    source: "code",
    dimension,
    iteration,
    mode,
    size: codeBatch.length,
    questions: codeBatch.map((q) => ({
      fact_id: q.fact_id,
      theme: q.theme,
      intended_angle: q.intended_angle,
      question: q.question,
    })),
  });

  return codeBatch;
}