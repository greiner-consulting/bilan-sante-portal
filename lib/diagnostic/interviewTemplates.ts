import type {
  DiagnosticFact,
  FactDimension,
  FactType,
  InstructionGoal,
  StatementMode,
} from "@/lib/diagnostic/types";

type InterviewTemplateFact = {
  key: string;
  theme: string;
  observed_element: string;
  managerial_risk: string;
  instruction_goal: InstructionGoal;
  preferred_question: string;
  prudent_hypothesis?: string;
  fact_type?: FactType;
  proof_level?: 1 | 2 | 3 | 4 | 5;
  allowed_statement_mode?: StatementMode;
  criticality_score?: number;
  confidence_score?: number;
  tags?: string[];
};

const INTERVIEW_TEMPLATES: Record<
  FactDimension,
  Record<1 | 2 | 3, InterviewTemplateFact[]>
> = {
  1: {
    1: [
      {
        key: "d1_i1_roles_responsabilites_1",
        theme: "roles et responsabilites",
        observed_element:
          "La répartition réelle des rôles entre dirigeant, commerce, chiffrage et encadrement n’est pas encore objectivée.",
        managerial_risk:
          "Sans clarification des rôles réellement tenus, des décisions utiles peuvent rester sans propriétaire clair.",
        instruction_goal: "verify",
        preferred_question:
          "Qui décide aujourd’hui, concrètement, de répondre ou non à une affaire, et à partir de quels critères ?",
        prudent_hypothesis:
          "La trame suggère un partage des responsabilités encore partiellement flou sur les décisions commerciales et opérationnelles.",
        proof_level: 2,
        allowed_statement_mode: "fact_only",
        criticality_score: 72,
        confidence_score: 62,
        tags: ["gouvernance", "decision", "roles"],
      },
      {
        key: "d1_i1_roles_responsabilites_2",
        theme: "roles et responsabilites",
        observed_element:
          "Le lien entre qualification commerciale, chiffrage et décision de poursuite d’affaire reste à clarifier.",
        managerial_risk:
          "Si les interfaces sont mal tenues, l’entreprise peut engager du temps sur des dossiers mal qualifiés ou mal chiffrés.",
        instruction_goal: "verify",
        preferred_question:
          "Pouvez-vous me décrire un cas récent où un dossier a été mal qualifié au départ, puis a créé une difficulté de chiffrage, de prix ou de pilotage ?",
        prudent_hypothesis:
          "Il peut exister une faiblesse d’interface entre le commercial et le chiffrage.",
        proof_level: 2,
        allowed_statement_mode: "fact_only",
        criticality_score: 78,
        confidence_score: 66,
        tags: ["interface", "commercial", "chiffrage"],
      },
      {
        key: "d1_i1_gouvernance_1",
        theme: "gouvernance",
        observed_element:
          "La gouvernance opérationnelle réelle et la part des arbitrages remontant au dirigeant ne sont pas encore objectivées.",
        managerial_risk:
          "Une gouvernance trop centralisée peut ralentir les arbitrages utiles et limiter l’autonomie effective des relais.",
        instruction_goal: "test_arbitration",
        preferred_question:
          "Sur les trois derniers mois, quel type de décision continue à remonter jusqu’à vous alors qu’elle devrait probablement être tranchée un niveau en dessous ?",
        prudent_hypothesis:
          "Certaines décisions semblent encore fortement dépendantes du dirigeant.",
        proof_level: 2,
        allowed_statement_mode: "fact_only",
        criticality_score: 80,
        confidence_score: 64,
        tags: ["gouvernance", "arbitrage", "centralisation"],
      },
      {
        key: "d1_i1_ligne_manageriale_1",
        theme: "ligne manageriale",
        observed_element:
          "La solidité réelle de la ligne managériale intermédiaire n’est pas encore documentée.",
        managerial_risk:
          "Une ligne managériale fragile peut dégrader la qualité d’exécution et multiplier les arbitrages tardifs.",
        instruction_goal: "verify",
        preferred_question:
          "Quels sont aujourd’hui les deux relais d’encadrement sur lesquels vous pouvez réellement compter, et sur quoi les jugez-vous fiables ?",
        prudent_hypothesis:
          "La robustesse des relais d’encadrement reste à confirmer.",
        proof_level: 2,
        allowed_statement_mode: "fact_only",
        criticality_score: 70,
        confidence_score: 60,
        tags: ["encadrement", "fiabilite", "execution"],
      },
      {
        key: "d1_i1_dependances_humaines_1",
        theme: "dependances humaines",
        observed_element:
          "Les dépendances à quelques personnes clés ne sont pas encore objectivées.",
        managerial_risk:
          "Une dépendance à un petit nombre de profils critiques fragilise la continuité de décision et d’exécution.",
        instruction_goal: "quantify",
        preferred_question:
          "Si deux personnes s’absentaient demain pendant un mois, lesquelles mettraient immédiatement l’activité en tension, et pourquoi ?",
        prudent_hypothesis:
          "L’organisation semble pouvoir reposer sur un nombre limité de personnes clés.",
        proof_level: 2,
        allowed_statement_mode: "fact_only",
        criticality_score: 76,
        confidence_score: 61,
        tags: ["dependance", "risque_humain", "continuite"],
      },
      {
        key: "d1_i1_rituels_manageriaux_1",
        theme: "rituels manageriaux",
        observed_element:
          "L’existence de rituels managériaux réellement tenus et utiles n’est pas encore démontrée.",
        managerial_risk:
          "Sans rituels stables, les écarts remontent tard et les arbitrages deviennent plus réactifs que pilotés.",
        instruction_goal: "verify",
        preferred_question:
          "Quels rituels tenez-vous réellement chaque semaine pour piloter l’activité, et lesquels ne tiennent pas dans la durée ?",
        prudent_hypothesis:
          "Les rituels de pilotage existent peut-être de manière inégale selon les sujets ou les équipes.",
        proof_level: 2,
        allowed_statement_mode: "fact_only",
        criticality_score: 68,
        confidence_score: 58,
        tags: ["rituels", "pilotage", "cadence"],
      },
    ],
    2: [
      {
        key: "d1_i2_arbitrages_1",
        theme: "gouvernance",
        observed_element:
          "Le mécanisme concret par lequel certains arbitrages remontent au dirigeant reste à qualifier.",
        managerial_risk:
          "Si les arbitrages remontent faute de cadre clair, l’organisation ralentit et sature rapidement le dirigeant.",
        instruction_goal: "explain_cause",
        preferred_question:
          "Quand une décision remonte jusqu’à vous, est-ce surtout un sujet de compétence, de confiance, de méthode ou de manque de cadre ?",
        prudent_hypothesis:
          "La remontée des arbitrages peut relever davantage d’un problème de cadre que d’un simple problème de personnes.",
        proof_level: 3,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 82,
        confidence_score: 70,
        tags: ["arbitrage", "cause", "gouvernance"],
      },
      {
        key: "d1_i2_roles_1",
        theme: "roles et responsabilites",
        observed_element:
          "L’écart entre rôle théorique et rôle réellement exercé par certains cadres reste à mesurer.",
        managerial_risk:
          "Un décalage durable entre organigramme et réalité crée des zones grises de décision et d’exécution.",
        instruction_goal: "measure_impact",
        preferred_question:
          "Sur quels sujets vos cadres ont-ils un titre ou une responsabilité affichée, mais sans capacité réelle à décider seuls ?",
        prudent_hypothesis:
          "Certains rôles peuvent être officiellement définis mais peu opérants dans la pratique.",
        proof_level: 3,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 79,
        confidence_score: 69,
        tags: ["roles", "realite", "efficacite"],
      },
      {
        key: "d1_i2_competences_1",
        theme: "competences critiques",
        observed_element:
          "Les compétences managériales ou techniques qui manquent réellement à l’encadrement ne sont pas encore hiérarchisées.",
        managerial_risk:
          "Sans identification précise des compétences manquantes, les remplacements ou renforcements risquent d’être mal ciblés.",
        instruction_goal: "quantify",
        preferred_question:
          "Parmi les difficultés actuelles de l’encadrement, lesquelles relèvent d’un manque de compétence technique, lesquelles relèvent d’un manque de capacité à tenir une équipe ?",
        prudent_hypothesis:
          "Les fragilités constatées peuvent mêler limites techniques et limites managériales.",
        proof_level: 3,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 74,
        confidence_score: 67,
        tags: ["competences", "encadrement", "tri"],
      },
      {
        key: "d1_i2_relais_1",
        theme: "relais d'encadrement",
        observed_element:
          "La capacité des relais d’encadrement à faire tenir les décisions dans la durée n’est pas encore démontrée.",
        managerial_risk:
          "Des relais faibles créent un pilotage discontinu et une exécution instable selon les affaires ou les équipes.",
        instruction_goal: "verify",
        preferred_question:
          "Quand vous prenez une décision, qui la fait réellement appliquer jusqu’au terrain, et où cela décroche-t-il le plus souvent ?",
        prudent_hypothesis:
          "L’enjeu peut porter moins sur la décision elle-même que sur sa tenue dans l’exécution.",
        proof_level: 3,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 77,
        confidence_score: 68,
        tags: ["relais", "execution", "tenue"],
      },
      {
        key: "d1_i2_dimensionnement_1",
        theme: "dimensionnement structure",
        observed_element:
          "L’adéquation entre structure actuelle, charge réelle et ambitions reste à objectiver.",
        managerial_risk:
          "Une structure mal dimensionnée peut alimenter soit la saturation soit la sous-charge improductive.",
        instruction_goal: "quantify",
        preferred_question:
          "Aujourd’hui, avez-vous plutôt un problème de manque de bras utiles, de manque de cadres solides, ou de structure trop lourde par rapport à l’activité ?",
        prudent_hypothesis:
          "Les difficultés observées peuvent traduire un désalignement entre charge réelle et structure.",
        proof_level: 3,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 81,
        confidence_score: 72,
        tags: ["structure", "charge", "dimensionnement"],
      },
      {
        key: "d1_i2_autonomie_1",
        theme: "autonomie encadrement",
        observed_element:
          "Le niveau d’autonomie réellement exercé par l’encadrement intermédiaire reste à préciser.",
        managerial_risk:
          "Une autonomie trop faible réduit la vitesse de décision et use le dirigeant sur des sujets de niveau insuffisant.",
        instruction_goal: "test_arbitration",
        preferred_question:
          "Quelles décisions voudriez-vous que vos cadres prennent seuls dès demain, mais qu’ils ne prennent pas encore ?",
        prudent_hypothesis:
          "Le sujet semble porter sur une autonomie incomplètement installée.",
        proof_level: 3,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 80,
        confidence_score: 71,
        tags: ["autonomie", "delegation", "decision"],
      },
    ],
    3: [
      {
        key: "d1_i3_cause_racine_1",
        theme: "gouvernance",
        observed_element:
          "La cause racine de la centralisation ou des arbitrages remontants doit être tranchée.",
        managerial_risk:
          "Sans cause racine claire, les actions correctives risquent de traiter les symptômes sans améliorer durablement la capacité d’exécution.",
        instruction_goal: "explain_cause",
        preferred_question:
          "Au fond, ce qui bloque aujourd’hui relève-t-il d’abord d’un problème de personnes, de structure, de méthode, ou d’un niveau d’exigence encore trop porté par vous seul ?",
        prudent_hypothesis:
          "La difficulté principale peut venir d’un décalage entre ambitions de pilotage et robustesse réelle des relais.",
        proof_level: 4,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 86,
        confidence_score: 77,
        tags: ["cause_racine", "gouvernance", "pilotage"],
      },
      {
        key: "d1_i3_dependance_1",
        theme: "dependances humaines",
        observed_element:
          "La dépendance à quelques profils ou au dirigeant lui-même doit être consolidée.",
        managerial_risk:
          "Une dépendance humaine trop forte fragilise la stabilité du redressement et limite la réplicabilité de la performance.",
        instruction_goal: "measure_impact",
        preferred_question:
          "Sur quoi l’entreprise reste-t-elle encore trop dépendante de vous ou de quelques personnes, au point de freiner sa stabilisation ?",
        prudent_hypothesis:
          "Le fonctionnement reste peut-être encore insuffisamment désensibilisé aux personnes clés.",
        proof_level: 4,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 84,
        confidence_score: 76,
        tags: ["dependance", "stabilisation", "resilience"],
      },
      {
        key: "d1_i3_relais_2",
        theme: "relais d'encadrement",
        observed_element:
          "La robustesse durable des relais d’encadrement doit être consolidée.",
        managerial_risk:
          "Sans relais solides, la transformation reste fragile et peu tenable dans la durée.",
        instruction_goal: "verify",
        preferred_question:
          "À horizon six mois, qu’est-ce qui vous permettra de dire que vos relais tiennent réellement la boutique sans reprise en main permanente de votre part ?",
        prudent_hypothesis:
          "Le test final porte sur la capacité des relais à tenir dans la durée, pas seulement à réagir ponctuellement.",
        proof_level: 4,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 82,
        confidence_score: 75,
        tags: ["relais", "durabilite", "autonomie"],
      },
      {
        key: "d1_i3_rituels_2",
        theme: "rituels manageriaux",
        observed_element:
          "Les rituels indispensables à une gouvernance plus stable doivent être explicités.",
        managerial_risk:
          "Sans rituels simples et tenus, les progrès restent dépendants d’efforts ponctuels plutôt que d’un pilotage régulier.",
        instruction_goal: "arbitrate" as never,
        preferred_question:
          "Parmi les rituels actuels, lesquels sont réellement indispensables à tenir sans négociation, et lesquels pouvez-vous arrêter sans risque ?",
        prudent_hypothesis:
          "La stabilisation passe probablement par un petit nombre de rituels non négociables.",
        proof_level: 4,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 78,
        confidence_score: 73,
        tags: ["rituels", "discipline", "stabilisation"],
      },
      {
        key: "d1_i3_structure_1",
        theme: "structure de pilotage",
        observed_element:
          "Le niveau de structure de pilotage nécessaire au redressement doit être finalisé.",
        managerial_risk:
          "Une structure de pilotage insuffisante empêche de transformer les constats en exécution suivie.",
        instruction_goal: "test_arbitration",
        preferred_question:
          "Quel est aujourd’hui l’arbitrage d’organisation que vous repoussez encore, alors qu’il serait probablement nécessaire pour stabiliser durablement le pilotage ?",
        prudent_hypothesis:
          "Un arbitrage d’organisation peut encore manquer pour sécuriser la stabilité du pilotage.",
        proof_level: 4,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 83,
        confidence_score: 74,
        tags: ["structure", "pilotage", "arbitrage"],
      },
    ],
  },

  2: {
    1: [
      {
        key: "d2_i1_dependance_client",
        theme: "dependance client",
        observed_element:
          "Le niveau réel de dépendance à un petit nombre de clients n’est pas encore objectivé.",
        managerial_risk:
          "Une forte dépendance clients fragilise le chiffre d’affaires et réduit la capacité de négociation.",
        instruction_goal: "quantify",
        preferred_question:
          "Quelle part de votre chiffre d’affaires est aujourd’hui portée par vos trois premiers clients, à grands traits ?",
        prudent_hypothesis:
          "Le portefeuille peut être plus concentré qu’il n’est souhaitable.",
        proof_level: 2,
        allowed_statement_mode: "fact_only",
        criticality_score: 85,
        confidence_score: 70,
        tags: ["portefeuille", "concentration", "clients"],
      },
      {
        key: "d2_i1_qualification_opportunites",
        theme: "qualification opportunites",
        observed_element:
          "La discipline réelle de qualification des opportunités n’est pas encore démontrée.",
        managerial_risk:
          "Une qualification faible dégrade le taux de transformation et consomme du temps sur des affaires peu pertinentes.",
        instruction_goal: "verify",
        preferred_question:
          "Quand une opportunité arrive, quels critères utilisez-vous vraiment pour dire très tôt qu’elle vaut la peine d’être poursuivie ?",
        prudent_hypothesis:
          "La machine commerciale peut encore manquer de critères de tri suffisamment fermes.",
        proof_level: 2,
        allowed_statement_mode: "fact_only",
        criticality_score: 79,
        confidence_score: 66,
        tags: ["qualification", "tri", "opportunites"],
      },
      {
        key: "d2_i1_prospection",
        theme: "prospection",
        observed_element:
          "L’existence d’une prospection réellement structurée n’est pas encore objectivée.",
        managerial_risk:
          "Sans prospection tenue dans la durée, la croissance reste dépendante des flux entrants ou de l’historique.",
        instruction_goal: "verify",
        preferred_question:
          "Aujourd’hui, qui prospecte réellement, à quelle fréquence, et avec quel niveau de méthode ?",
        prudent_hypothesis:
          "La prospection peut être plus opportuniste que systématique.",
        proof_level: 2,
        allowed_statement_mode: "fact_only",
        criticality_score: 74,
        confidence_score: 62,
        tags: ["prospection", "discipline", "conquete"],
      },
      {
        key: "d2_i1_pipeline",
        theme: "pipeline",
        observed_element:
          "Le pipeline commercial existe peut-être, mais son niveau d’usage réel n’est pas encore établi.",
        managerial_risk:
          "Un pipeline peu piloté rend la prévision commerciale peu fiable et dégrade l’allocation des efforts.",
        instruction_goal: "verify",
        preferred_question:
          "Votre pipeline vous sert-il réellement à arbitrer les priorités commerciales, ou plutôt à constater après coup ce qui s’est passé ?",
        prudent_hypothesis:
          "Le pipeline peut être davantage déclaratif que décisionnel.",
        proof_level: 2,
        allowed_statement_mode: "fact_only",
        criticality_score: 76,
        confidence_score: 64,
        tags: ["pipeline", "pilotage", "priorites"],
      },
      {
        key: "d2_i1_positionnement",
        theme: "positionnement marche",
        observed_element:
          "Le positionnement réellement assumé sur le marché reste à clarifier.",
        managerial_risk:
          "Un positionnement flou dilue les efforts commerciaux et affaiblit la proposition de valeur.",
        instruction_goal: "verify",
        preferred_question:
          "Sur quels types d’affaires ou de clients estimez-vous aujourd’hui être vraiment crédibles et différenciants ?",
        prudent_hypothesis:
          "Le portefeuille peut être plus subi que vraiment choisi.",
        proof_level: 2,
        allowed_statement_mode: "fact_only",
        criticality_score: 77,
        confidence_score: 63,
        tags: ["positionnement", "marche", "ciblage"],
      },
      {
        key: "d2_i1_animation",
        theme: "animation commerciale",
        observed_element:
          "L’animation commerciale réelle et sa régularité ne sont pas encore démontrées.",
        managerial_risk:
          "Sans animation commerciale suivie, les actions se dispersent et les priorités se diluent.",
        instruction_goal: "verify",
        preferred_question:
          "Quels moments de pilotage commercial tenez-vous réellement pour suivre les affaires, les pertes, les gains et les priorités ?",
        prudent_hypothesis:
          "L’animation commerciale peut exister de façon irrégulière ou insuffisamment sélective.",
        proof_level: 2,
        allowed_statement_mode: "fact_only",
        criticality_score: 73,
        confidence_score: 61,
        tags: ["animation", "commercial", "pilotage"],
      },
    ],
    2: [
      {
        key: "d2_i2_concentration",
        theme: "portefeuille clients",
        observed_element:
          "La concentration du portefeuille et ses effets sur la stabilité commerciale doivent être précisés.",
        managerial_risk:
          "Un portefeuille trop concentré rend l’activité plus vulnérable à la perte d’un client ou d’un segment.",
        instruction_goal: "measure_impact",
        preferred_question:
          "Si vous perdiez demain votre principal client, quelle serait l’ampleur du choc pour l’activité et sur combien de temps pourriez-vous compenser ?",
        prudent_hypothesis:
          "Le portefeuille pourrait être insuffisamment résilient en cas de perte d’un compte important.",
        proof_level: 3,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 86,
        confidence_score: 74,
        tags: ["resilience", "clients", "concentration"],
      },
      {
        key: "d2_i2_machine_commerciale",
        theme: "machine commerciale",
        observed_element:
          "La machine commerciale réelle doit être distinguée d’une simple accumulation d’opportunités.",
        managerial_risk:
          "Une machine commerciale peu industrialisée crée de l’activité apparente sans garantir de résultats robustes.",
        instruction_goal: "explain_cause",
        preferred_question:
          "Ce qui vous manque aujourd’hui pour avoir une vraie machine commerciale, est-ce d’abord du volume, de la méthode, de la sélectivité, ou de la tenue managériale ?",
        prudent_hypothesis:
          "Le sujet peut porter moins sur le nombre d’opportunités que sur la discipline qui les transforme.",
        proof_level: 3,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 82,
        confidence_score: 72,
        tags: ["machine", "discipline", "transformation"],
      },
      {
        key: "d2_i2_motifs_perte",
        theme: "motifs de gain ou de perte",
        observed_element:
          "Les raisons récurrentes de gain ou de perte ne sont pas encore capitalisées de façon claire.",
        managerial_risk:
          "Sans lecture nette des motifs de perte, l’entreprise reproduit les mêmes erreurs commerciales.",
        instruction_goal: "verify",
        preferred_question:
          "Sur les affaires perdues récemment, quelles sont les deux raisons qui reviennent le plus souvent, concrètement ?",
        prudent_hypothesis:
          "Les pertes peuvent ne pas être suffisamment relues pour corriger la méthode commerciale.",
        proof_level: 3,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 78,
        confidence_score: 70,
        tags: ["pertes", "retour_experience", "correction"],
      },
      {
        key: "d2_i2_focalisation",
        theme: "focalisation sectorielle",
        observed_element:
          "La focalisation sectorielle réellement assumée reste à préciser.",
        managerial_risk:
          "Une focalisation insuffisante disperse les efforts et complique la capitalisation commerciale.",
        instruction_goal: "test_arbitration",
        preferred_question:
          "Quels segments ou types de clients poursuivez-vous encore aujourd’hui alors qu’ils mobilisent du temps sans vraie perspective de rentabilité ou de répétabilité ?",
        prudent_hypothesis:
          "La dispersion sectorielle peut encore consommer des ressources au détriment des segments plus porteurs.",
        proof_level: 3,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 80,
        confidence_score: 71,
        tags: ["focalisation", "segments", "arbitrage"],
      },
      {
        key: "d2_i2_diversification",
        theme: "diversification",
        observed_element:
          "La diversification souhaitée n’est pas encore traduite en logique commerciale robuste.",
        managerial_risk:
          "Une diversification insuffisamment construite peut créer de la dispersion sans réduire la dépendance.",
        instruction_goal: "verify",
        preferred_question:
          "La diversification que vous recherchez repose-t-elle déjà sur des offres, des cibles et des relais commerciaux identifiés, ou reste-t-elle encore surtout une intention ?",
        prudent_hypothesis:
          "La diversification peut être visée sans être encore suffisamment outillée commercialement.",
        proof_level: 3,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 77,
        confidence_score: 69,
        tags: ["diversification", "offre", "cibles"],
      },
      {
        key: "d2_i2_priorisation",
        theme: "priorisation opportunites",
        observed_element:
          "La capacité à prioriser réellement les opportunités ne paraît pas encore totalement sécurisée.",
        managerial_risk:
          "Une priorisation faible consomme le temps commercial sur trop de dossiers hétérogènes.",
        instruction_goal: "quantify",
        preferred_question:
          "Sur dix opportunités ouvertes aujourd’hui, combien méritent réellement un effort commercial fort, et sur quels critères les distinguez-vous ?",
        prudent_hypothesis:
          "Le portefeuille d’opportunités peut être insuffisamment hiérarchisé.",
        proof_level: 3,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 79,
        confidence_score: 70,
        tags: ["priorisation", "opportunites", "tri"],
      },
    ],
    3: [
      {
        key: "d2_i3_viabilite",
        theme: "dependance client",
        observed_element:
          "La viabilité du modèle commercial hors client ou segment historique doit être consolidée.",
        managerial_risk:
          "Si la croissance hors historique n’est pas robuste, l’entreprise reste exposée à une dépendance structurelle.",
        instruction_goal: "verify",
        preferred_question:
          "À quoi verriez-vous concrètement, dans six mois, que votre portefeuille clients est devenu plus sain et moins dépendant ?",
        prudent_hypothesis:
          "La consolidation doit confirmer la capacité à réduire réellement la dépendance commerciale.",
        proof_level: 4,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 87,
        confidence_score: 78,
        tags: ["viabilite", "dependance", "portefeuille"],
      },
      {
        key: "d2_i3_selectivite",
        theme: "qualification opportunites",
        observed_element:
          "La sélectivité commerciale cible n’est pas encore explicitée.",
        managerial_risk:
          "Sans sélectivité assumée, l’entreprise continue à consommer du temps sur des opportunités peu utiles.",
        instruction_goal: "test_arbitration",
        preferred_question:
          "Quelles opportunités devriez-vous objectivement moins poursuivre demain, même si elles apportent du volume apparent ?",
        prudent_hypothesis:
          "Le vrai progrès commercial peut passer par moins d’affaires poursuivies, mais mieux choisies.",
        proof_level: 4,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 84,
        confidence_score: 76,
        tags: ["selectivite", "arbitrage", "efficacite"],
      },
      {
        key: "d2_i3_zone_non_pilotee",
        theme: "animation commerciale",
        observed_element:
          "Une ou plusieurs zones commerciales restent probablement insuffisamment pilotées.",
        managerial_risk:
          "Une zone non pilotée laisse se reproduire les mêmes pertes d’efficacité.",
        instruction_goal: "verify",
        preferred_question:
          "Quel sujet commercial sentez-vous encore insuffisamment piloté aujourd’hui malgré les actions déjà engagées ?",
        prudent_hypothesis:
          "La consolidation peut encore faire apparaître une zone commerciale non suffisamment tenue.",
        proof_level: 4,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 80,
        confidence_score: 74,
        tags: ["pilotage", "zone_non_pilotee", "commercial"],
      },
      {
        key: "d2_i3_cause_racine",
        theme: "machine commerciale",
        observed_element:
          "La cause racine dominante de la faiblesse commerciale doit être clarifiée.",
        managerial_risk:
          "Sans cause racine claire, les actions commerciales risquent de rester dispersées et peu efficaces.",
        instruction_goal: "explain_cause",
        preferred_question:
          "Au fond, ce qui freine le plus votre performance commerciale relève-t-il aujourd’hui du portefeuille, de la méthode, du management commercial, ou du positionnement ?",
        prudent_hypothesis:
          "La faiblesse commerciale peut relever d’un noyau de causes plus resserré qu’il n’y paraît.",
        proof_level: 4,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 88,
        confidence_score: 79,
        tags: ["cause_racine", "commercial", "diagnostic"],
      },
      {
        key: "d2_i3_conquete",
        theme: "strategie de conquete",
        observed_element:
          "La stratégie de conquête durablement tenable doit être consolidée.",
        managerial_risk:
          "Une conquête mal cadrée peut créer du mouvement commercial sans vraie amélioration de qualité du portefeuille.",
        instruction_goal: "test_arbitration",
        preferred_question:
          "Quelle orientation de conquête allez-vous privilégier demain, et laquelle allez-vous au contraire réduire franchement ?",
        prudent_hypothesis:
          "La consolidation doit déboucher sur un choix plus net de conquête.",
        proof_level: 4,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 82,
        confidence_score: 75,
        tags: ["conquete", "choix", "priorites"],
      },
    ],
  },

  3: {
    1: [
      {
        key: "d3_i1_prix",
        theme: "prix",
        observed_element:
          "La logique réelle de construction du prix n’est pas encore objectivée.",
        managerial_risk:
          "Un prix mal construit expose à signer des affaires insuffisamment rentables dès l’origine.",
        instruction_goal: "verify",
        preferred_question:
          "Aujourd’hui, comment construisez-vous concrètement votre prix avant envoi au client ?",
        prudent_hypothesis:
          "Le processus de formation du prix peut reposer sur des hypothèses encore insuffisamment sécurisées.",
        proof_level: 2,
        allowed_statement_mode: "fact_only",
        criticality_score: 84,
        confidence_score: 70,
        tags: ["prix", "construction", "rentabilite"],
      },
      {
        key: "d3_i1_negociation",
        theme: "negociation",
        observed_element:
          "La discipline de négociation réelle n’est pas encore démontrée.",
        managerial_risk:
          "Une négociation mal tenue peut dégrader la marge avant même le démarrage de l’affaire.",
        instruction_goal: "verify",
        preferred_question:
          "Quand un client vous demande un effort, jusqu’où acceptez-vous de descendre, et à partir de quel moment dites-vous non ?",
        prudent_hypothesis:
          "Les bornes de négociation peuvent ne pas être suffisamment tenues.",
        proof_level: 2,
        allowed_statement_mode: "fact_only",
        criticality_score: 82,
        confidence_score: 68,
        tags: ["negociation", "discipline", "marge"],
      },
      {
        key: "d3_i1_go_no_go",
        theme: "arbitrage go/no go",
        observed_element:
          "Le cadre réel de décision go/no go n’est pas encore objectivé.",
        managerial_risk:
          "Sans filtre économique clair, l’entreprise peut poursuivre des dossiers peu compatibles avec sa structure ou sa rentabilité cible.",
        instruction_goal: "verify",
        preferred_question:
          "Quels sont aujourd’hui les critères qui vous font dire non à une affaire avant d’y passer davantage de temps ?",
        prudent_hypothesis:
          "Le go/no go peut être plus intuitif que réellement cadré.",
        proof_level: 2,
        allowed_statement_mode: "fact_only",
        criticality_score: 85,
        confidence_score: 69,
        tags: ["go_no_go", "tri", "selectivite"],
      },
      {
        key: "d3_i1_marge",
        theme: "marge",
        observed_element:
          "Le niveau de marge visé à la vente et son caractère réellement défendu restent à clarifier.",
        managerial_risk:
          "Une marge vendue insuffisante ou mal protégée fragilise immédiatement l’économie des affaires.",
        instruction_goal: "quantify",
        preferred_question:
          "Quel niveau de marge minimale essayez-vous réellement de défendre avant signature, même à grands traits ?",
        prudent_hypothesis:
          "Le seuil de marge acceptable peut ne pas être suffisamment explicite ou stabilisé.",
        proof_level: 2,
        allowed_statement_mode: "fact_only",
        criticality_score: 86,
        confidence_score: 71,
        tags: ["marge", "seuil", "vente"],
      },
      {
        key: "d3_i1_cout_chiffrage",
        theme: "cout de chiffrage",
        observed_element:
          "Le coût réel du chiffrage et le niveau d’effort consommé sur les offres ne sont pas encore mesurés.",
        managerial_risk:
          "Un chiffrage coûteux sur trop d’affaires peu qualifiées dégrade la productivité commerciale globale.",
        instruction_goal: "quantify",
        preferred_question:
          "Combien d’offres importantes produisez-vous environ sur un mois, et quelle part vous semble objectivement avoir peu de chances d’aboutir ?",
        prudent_hypothesis:
          "Le coût d’acquisition peut être pénalisé par un volume d’offres trop peu sélectif.",
        proof_level: 2,
        allowed_statement_mode: "fact_only",
        criticality_score: 78,
        confidence_score: 65,
        tags: ["chiffrage", "cout_acquisition", "volume"],
      },
      {
        key: "d3_i1_cycle",
        theme: "cycle de vente",
        observed_element:
          "La durée réelle du cycle de vente et ses effets économiques ne sont pas encore objectivés.",
        managerial_risk:
          "Un cycle long et peu filtré immobilise des ressources sur des affaires incertaines.",
        instruction_goal: "quantify",
        preferred_question:
          "Sur vos affaires significatives, le cycle de vente est plutôt court, moyen ou long, et où perdez-vous le plus de temps ?",
        prudent_hypothesis:
          "Le cycle commercial peut peser davantage que prévu sur l’efficacité économique de la machine d’acquisition.",
        proof_level: 2,
        allowed_statement_mode: "fact_only",
        criticality_score: 75,
        confidence_score: 63,
        tags: ["cycle", "vente", "temps"],
      },
    ],
    2: [
      {
        key: "d3_i2_degradation_prix",
        theme: "prix",
        observed_element:
          "Le mécanisme concret de dégradation du prix doit être précisé.",
        managerial_risk:
          "Si la baisse de prix vient d’un mauvais cadrage amont, la négociation finale ne fait qu’amplifier une faiblesse déjà présente.",
        instruction_goal: "explain_cause",
        preferred_question:
          "Quand le prix se dégrade, est-ce surtout parce que l’affaire est mal cadrée au départ, parce que le marché pousse, ou parce que vous avez besoin du chiffre ?",
        prudent_hypothesis:
          "La dégradation du prix peut traduire un problème amont plus qu’un simple problème de négociation finale.",
        proof_level: 3,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 88,
        confidence_score: 76,
        tags: ["prix", "cause", "degradation"],
      },
      {
        key: "d3_i2_selectivite",
        theme: "selectivite economique",
        observed_element:
          "La sélectivité économique réelle doit être distinguée du simple besoin de volume.",
        managerial_risk:
          "Une sélectivité trop faible fait entrer dans le pipe des affaires peu compatibles avec la structure ou la marge cible.",
        instruction_goal: "test_arbitration",
        preferred_question:
          "Quelles affaires continuez-vous encore à regarder alors qu’économiquement vous savez déjà qu’elles sont peu attractives ?",
        prudent_hypothesis:
          "Le besoin de chiffre peut parfois l’emporter sur la discipline de sélection.",
        proof_level: 3,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 86,
        confidence_score: 75,
        tags: ["selectivite", "volume", "arbitrage"],
      },
      {
        key: "d3_i2_marge_realisee",
        theme: "marge vendue vs realisee",
        observed_element:
          "L’écart entre marge vendue et marge réellement réalisée doit être qualifié.",
        managerial_risk:
          "Si l’écart est récurrent, le problème peut se situer autant dans la vente que dans l’exécution.",
        instruction_goal: "measure_impact",
        preferred_question:
          "Quand une affaire déçoit en marge, l’écart vient plus souvent du prix vendu au départ ou des dérives d’exécution ensuite ?",
        prudent_hypothesis:
          "Une partie de la dérive économique peut naître dès la vente.",
        proof_level: 3,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 87,
        confidence_score: 77,
        tags: ["marge", "realisation", "ecart"],
      },
      {
        key: "d3_i2_negociation_2",
        theme: "negociation",
        observed_element:
          "Les marges de manœuvre réelles en négociation et leurs limites doivent être précisées.",
        managerial_risk:
          "Sans bornes explicites, la négociation peut devenir un point de fuite régulier de la rentabilité.",
        instruction_goal: "verify",
        preferred_question:
          "Disposez-vous de vraies limites non négociables en négociation, et comment sont-elles tenues quand la pression commerciale monte ?",
        prudent_hypothesis:
          "Les limites de négociation peuvent exister mais être difficilement tenues sous pression.",
        proof_level: 3,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 81,
        confidence_score: 73,
        tags: ["negociation", "limites", "pression"],
      },
      {
        key: "d3_i2_chiffrage",
        theme: "cout de chiffrage",
        observed_element:
          "L’effort de chiffrage consacré à des affaires peu prometteuses doit être mesuré.",
        managerial_risk:
          "Un chiffrage trop dispersé dégrade le coût d’acquisition et la disponibilité des ressources utiles.",
        instruction_goal: "quantify",
        preferred_question:
          "Sur dix chiffrages significatifs, combien considérez-vous après coup comme du temps mal investi ?",
        prudent_hypothesis:
          "Le coût caché du chiffrage peut peser fortement sur la machine commerciale.",
        proof_level: 3,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 79,
        confidence_score: 71,
        tags: ["chiffrage", "dispersion", "cout"],
      },
      {
        key: "d3_i2_criteres",
        theme: "criteres de poursuite d'affaire",
        observed_element:
          "Les critères de poursuite d’affaire doivent être rendus plus explicites.",
        managerial_risk:
          "Des critères flous laissent entrer trop d’affaires hétérogènes et rendent la sélectivité inopérante.",
        instruction_goal: "verify",
        preferred_question:
          "Quels critères devraient objectivement éliminer une affaire plus tôt, mais ne jouent pas encore suffisamment leur rôle aujourd’hui ?",
        prudent_hypothesis:
          "La question peut être moins l’absence de critères que leur faible application effective.",
        proof_level: 3,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 80,
        confidence_score: 72,
        tags: ["criteres", "tri", "discipline"],
      },
    ],
    3: [
      {
        key: "d3_i3_modele",
        theme: "robustesse économique du modèle",
        observed_element:
          "La robustesse économique du modèle commercial doit être consolidée.",
        managerial_risk:
          "Un modèle qui vend sans assez de discipline reste vulnérable à la pression prix et à la dérive de marge.",
        instruction_goal: "verify",
        preferred_question:
          "À quoi reconnaîtrez-vous dans six mois que votre modèle de vente est devenu plus robuste économiquement ?",
        prudent_hypothesis:
          "La vraie amélioration passera par une discipline économique plus visible et plus tenable.",
        proof_level: 4,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 89,
        confidence_score: 80,
        tags: ["modele", "robustesse", "economie"],
      },
      {
        key: "d3_i3_go_no_go_2",
        theme: "arbitrage go/no go",
        observed_element:
          "Le go/no go cible doit être consolidé dans un cadre réellement assumé.",
        managerial_risk:
          "Sans arbitrage ferme, les mêmes affaires peu sélectives continueront d’entrer dans le pipe.",
        instruction_goal: "test_arbitration",
        preferred_question:
          "Quel type d’affaire allez-vous désormais refuser plus tôt, même si cela réduit le volume apparent à court terme ?",
        prudent_hypothesis:
          "La consolidation doit se traduire par des refus plus assumés.",
        proof_level: 4,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 88,
        confidence_score: 79,
        tags: ["go_no_go", "refus", "volume"],
      },
      {
        key: "d3_i3_marge_2",
        theme: "marge",
        observed_element:
          "Le seuil de marge réellement défendable doit être clarifié durablement.",
        managerial_risk:
          "Sans seuil défendu, le besoin de chiffre continue à dégrader la rentabilité des affaires.",
        instruction_goal: "quantify",
        preferred_question:
          "Quel seuil de marge considérez-vous désormais comme non négociable pour protéger la santé du modèle ?",
        prudent_hypothesis:
          "La consolidation suppose une borne économique plus explicite et plus tenue.",
        proof_level: 4,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 90,
        confidence_score: 81,
        tags: ["marge", "seuil", "discipline"],
      },
      {
        key: "d3_i3_cause",
        theme: "discipline commerciale economique",
        observed_element:
          "La cause dominante des dérives économiques à la vente doit être tranchée.",
        managerial_risk:
          "Sans cause dominante claire, la correction restera partielle et les dérives se reproduiront.",
        instruction_goal: "explain_cause",
        preferred_question:
          "Au fond, ce qui vous coûte le plus à la vente relève-t-il d’un problème de tri, de chiffrage, de négociation ou de besoin de volume ?",
        prudent_hypothesis:
          "La difficulté dominante peut être plus concentrée qu’elle n’apparaît aujourd’hui.",
        proof_level: 4,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 91,
        confidence_score: 82,
        tags: ["cause_racine", "vente", "economie"],
      },
      {
        key: "d3_i3_capitalisation",
        theme: "capitalisation affaires gagnees/perdues",
        observed_element:
          "La capitalisation économique sur les affaires gagnées et perdues doit être consolidée.",
        managerial_risk:
          "Sans capitalisation utile, la machine de vente répète les mêmes choix et les mêmes erreurs.",
        instruction_goal: "verify",
        preferred_question:
          "Qu’avez-vous formalisé ou retenu récemment de façon suffisamment claire pour éviter de reproduire les mêmes erreurs sur les prochaines affaires ?",
        prudent_hypothesis:
          "La robustesse économique suppose un apprentissage réellement exploité, pas seulement constaté.",
        proof_level: 4,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 78,
        confidence_score: 74,
        tags: ["capitalisation", "apprentissage", "boucle"],
      },
    ],
  },

  4: {
    1: [
      {
        key: "d4_i1_pilotage",
        theme: "pilotage operationnel",
        observed_element:
          "La qualité réelle du pilotage opérationnel n’est pas encore objectivée.",
        managerial_risk:
          "Un pilotage insuffisant laisse dériver les écarts de délai, de qualité ou de productivité avant correction.",
        instruction_goal: "verify",
        preferred_question:
          "Comment détectez-vous aujourd’hui qu’une affaire ou un chantier commence à dériver, avant qu’il ne soit trop tard ?",
        prudent_hypothesis:
          "Le pilotage des écarts peut encore être plus réactif que préventif.",
        proof_level: 2,
        allowed_statement_mode: "fact_only",
        criticality_score: 84,
        confidence_score: 69,
        tags: ["pilotage", "ecarts", "anticipation"],
      },
      {
        key: "d4_i1_derives",
        theme: "derives",
        observed_element:
          "Les dérives les plus fréquentes dans l’exécution ne sont pas encore hiérarchisées.",
        managerial_risk:
          "Sans hiérarchie claire des dérives, les actions correctives restent diffuses et peu efficaces.",
        instruction_goal: "verify",
        preferred_question:
          "Sur vos opérations récentes, qu’est-ce qui dérive le plus souvent en premier : le délai, la productivité, la qualité, la préparation ou la documentation ?",
        prudent_hypothesis:
          "Les dérives semblent pouvoir se concentrer sur un nombre limité de mécanismes récurrents.",
        proof_level: 2,
        allowed_statement_mode: "fact_only",
        criticality_score: 82,
        confidence_score: 68,
        tags: ["derives", "priorites", "execution"],
      },
      {
        key: "d4_i1_coordination",
        theme: "coordination commerce-etudes-production-terrain",
        observed_element:
          "La qualité des interfaces entre commerce, études, production et terrain n’est pas encore démontrée.",
        managerial_risk:
          "Des interfaces fragiles créent des pertes d’information, des erreurs de préparation et des dérives de réalisation.",
        instruction_goal: "verify",
        preferred_question:
          "À quel moment l’information se déforme le plus entre la vente, la préparation et l’exécution ?",
        prudent_hypothesis:
          "Les dérives opérationnelles peuvent naître d’abord d’un problème d’interface.",
        proof_level: 2,
        allowed_statement_mode: "fact_only",
        criticality_score: 86,
        confidence_score: 70,
        tags: ["interfaces", "coordination", "transmission"],
      },
      {
        key: "d4_i1_rituels",
        theme: "rituels de pilotage operationnel",
        observed_element:
          "Les rituels de pilotage opérationnel réellement tenus ne sont pas encore objectivés.",
        managerial_risk:
          "Sans rituels tenus, les écarts s’installent et les décisions correctives arrivent tard.",
        instruction_goal: "verify",
        preferred_question:
          "Quels rituels opérationnels tenez-vous réellement pour suivre l’avancement, les écarts et les priorités d’exécution ?",
        prudent_hypothesis:
          "Le pilotage opérationnel peut manquer de rituels simples mais rigoureux.",
        proof_level: 2,
        allowed_statement_mode: "fact_only",
        criticality_score: 76,
        confidence_score: 63,
        tags: ["rituels", "operationnel", "cadence"],
      },
      {
        key: "d4_i1_charge_capacite",
        theme: "charge et capacite",
        observed_element:
          "L’équilibre réel entre charge, capacité et lissage d’activité n’est pas encore précisé.",
        managerial_risk:
          "Un mauvais équilibre charge-capacité dégrade soit la productivité soit la qualité d’exécution.",
        instruction_goal: "quantify",
        preferred_question:
          "Avez-vous aujourd’hui plutôt un sujet de surcharge, de sous-charge, ou d’à-coups difficiles à absorber dans l’exécution ?",
        prudent_hypothesis:
          "La performance opérationnelle peut être pénalisée par un déséquilibre de charge plus que par un seul problème de méthode.",
        proof_level: 2,
        allowed_statement_mode: "fact_only",
        criticality_score: 80,
        confidence_score: 66,
        tags: ["charge", "capacite", "lissage"],
      },
      {
        key: "d4_i1_standards",
        theme: "standards d'execution",
        observed_element:
          "Le niveau de standardisation réelle de l’exécution n’est pas encore établi.",
        managerial_risk:
          "Sans standards suffisamment tenus, la qualité et la productivité deviennent trop dépendantes des personnes ou des contextes.",
        instruction_goal: "verify",
        preferred_question:
          "Qu’est-ce qui, dans votre exécution, est aujourd’hui vraiment standardisé et reproductible, et qu’est-ce qui dépend encore trop des individus ?",
        prudent_hypothesis:
          "La variabilité d’exécution peut traduire une standardisation incomplète.",
        proof_level: 2,
        allowed_statement_mode: "fact_only",
        criticality_score: 79,
        confidence_score: 65,
        tags: ["standards", "reproductibilite", "variabilite"],
      },
    ],
    2: [
      {
        key: "d4_i2_cause_derives",
        theme: "causes de non-performance",
        observed_element:
          "La cause dominante des dérives opérationnelles doit être qualifiée.",
        managerial_risk:
          "Sans cause dominante claire, les corrections restent dispersées et peu durables.",
        instruction_goal: "explain_cause",
        preferred_question:
          "Quand une affaire dérape, la cause vient le plus souvent d’une mauvaise préparation, d’un manque de pilotage, d’un problème d’interface, d’un manque de ressources, ou d’autre chose ?",
        prudent_hypothesis:
          "Les dérives peuvent relever d’un petit nombre de causes racines récurrentes.",
        proof_level: 3,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 88,
        confidence_score: 76,
        tags: ["cause", "derives", "non_performance"],
      },
      {
        key: "d4_i2_ecarts",
        theme: "traitement des ecarts",
        observed_element:
          "Le mode réel de traitement des écarts doit être précisé.",
        managerial_risk:
          "Des écarts détectés tard ou mal traités dégradent simultanément marge, délais et qualité.",
        instruction_goal: "measure_impact",
        preferred_question:
          "Quand un écart apparaît, combien de temps mettez-vous en général à le voir, à le qualifier et à décider d’une correction utile ?",
        prudent_hypothesis:
          "Le délai de réaction aux écarts peut peser fortement sur la performance finale.",
        proof_level: 3,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 83,
        confidence_score: 73,
        tags: ["ecarts", "reaction", "traitement"],
      },
      {
        key: "d4_i2_priorites",
        theme: "arbitrage des priorites",
        observed_element:
          "La manière dont les priorités opérationnelles sont réellement arbitrées reste à clarifier.",
        managerial_risk:
          "Des priorités mouvantes ou mal arbitrées désorganisent les équipes et dégradent l’exécution.",
        instruction_goal: "test_arbitration",
        preferred_question:
          "Quand plusieurs urgences se présentent en même temps, qui tranche réellement les priorités et sur quelle base ?",
        prudent_hypothesis:
          "Le vrai sujet peut porter sur la qualité de l’arbitrage plus que sur le volume des urgences.",
        proof_level: 3,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 81,
        confidence_score: 72,
        tags: ["priorites", "arbitrage", "urgences"],
      },
      {
        key: "d4_i2_documentaire",
        theme: "gestion documentaire",
        observed_element:
          "Le poids réel des défauts documentaires dans les dérives n’est pas encore objectivé.",
        managerial_risk:
          "Une gestion documentaire faible peut retarder la facturation, compliquer la réception et créer des frottements évitables.",
        instruction_goal: "verify",
        preferred_question:
          "Dans vos difficultés d’exécution, quelle part viennent aujourd’hui de défauts documentaires, de préparation ou de traçabilité ?",
        prudent_hypothesis:
          "Le documentaire peut peser davantage qu’il n’apparaît spontanément dans la performance opérationnelle.",
        proof_level: 3,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 77,
        confidence_score: 69,
        tags: ["documentaire", "facturation", "traçabilite"],
      },
      {
        key: "d4_i2_productivite",
        theme: "productivite",
        observed_element:
          "Les mécanismes qui pèsent réellement sur la productivité doivent être explicités.",
        managerial_risk:
          "Sans lecture claire des causes de sous-productivité, les actions restent générales et peu efficaces.",
        instruction_goal: "explain_cause",
        preferred_question:
          "Ce qui dégrade le plus votre productivité aujourd’hui vient-il surtout de la préparation, des reprises, des interruptions, du niveau d’encadrement ou de la charge ?",
        prudent_hypothesis:
          "La sous-productivité peut relever de mécanismes répétitifs identifiables et traitables.",
        proof_level: 3,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 85,
        confidence_score: 75,
        tags: ["productivite", "causes", "terrain"],
      },
      {
        key: "d4_i2_preparation",
        theme: "preparation chantier",
        observed_element:
          "La qualité de préparation des opérations doit être mieux qualifiée.",
        managerial_risk:
          "Une préparation insuffisante transfère les problèmes en exécution, où ils coûtent plus cher.",
        instruction_goal: "verify",
        preferred_question:
          "À quel moment considérez-vous qu’un chantier ou une affaire est suffisamment préparé pour partir dans de bonnes conditions ?",
        prudent_hypothesis:
          "Une partie des dérives peut résulter d’un niveau de préparation insuffisant au départ.",
        proof_level: 3,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 82,
        confidence_score: 73,
        tags: ["preparation", "lancement", "qualite_depart"],
      },
    ],
    3: [
      {
        key: "d4_i3_robustesse",
        theme: "pilotage operationnel",
        observed_element:
          "La robustesse opérationnelle cible doit être consolidée.",
        managerial_risk:
          "Sans robustesse accrue, la performance reste trop sensible aux à-coups, aux personnes ou aux interfaces.",
        instruction_goal: "verify",
        preferred_question:
          "À quoi verrez-vous concrètement, dans six mois, que votre exécution est devenue plus robuste et moins dépendante des crises du quotidien ?",
        prudent_hypothesis:
          "La robustesse opérationnelle doit se traduire par moins d’écarts subis et plus d’anticipation.",
        proof_level: 4,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 89,
        confidence_score: 80,
        tags: ["robustesse", "execution", "stabilite"],
      },
      {
        key: "d4_i3_zone_non_pilotee",
        theme: "traitement des ecarts",
        observed_element:
          "Une ou plusieurs zones non pilotées peuvent encore subsister dans l’exécution.",
        managerial_risk:
          "Toute zone non pilotée laisse se reconstituer des dérives de marge, délai ou qualité.",
        instruction_goal: "verify",
        preferred_question:
          "Quel point d’exécution reste aujourd’hui encore insuffisamment piloté malgré les efforts déjà engagés ?",
        prudent_hypothesis:
          "La stabilisation peut buter sur une zone de pilotage encore insuffisamment tenue.",
        proof_level: 4,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 81,
        confidence_score: 75,
        tags: ["zone_non_pilotee", "ecarts", "stabilisation"],
      },
      {
        key: "d4_i3_cause_racine",
        theme: "causes de non-performance",
        observed_element:
          "La cause racine dominante des dérives opérationnelles doit être tranchée.",
        managerial_risk:
          "Sans cause racine claire, les plans d’actions restent superficiels et les écarts reviennent.",
        instruction_goal: "explain_cause",
        preferred_question:
          "Au fond, la cause principale de vos dérives d’exécution relève-t-elle surtout de la préparation, du pilotage, de l’organisation, des interfaces ou du niveau de standardisation ?",
        prudent_hypothesis:
          "Une cause dominante plus structurante peut se dégager derrière plusieurs symptômes apparents.",
        proof_level: 4,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 91,
        confidence_score: 82,
        tags: ["cause_racine", "execution", "derives"],
      },
      {
        key: "d4_i3_priorite",
        theme: "arbitrage des priorites",
        observed_element:
          "Les arbitrages de priorités qui conditionnent la robustesse future doivent être explicités.",
        managerial_risk:
          "Sans arbitrage clair, l’organisation continue à courir plusieurs urgences sans traiter le noyau des dérives.",
        instruction_goal: "test_arbitration",
        preferred_question:
          "Quel arbitrage opérationnel difficile devez-vous désormais tenir, même s’il crée de la tension à court terme, pour gagner en robustesse ?",
        prudent_hypothesis:
          "La robustesse future suppose probablement un arbitrage plus net entre court terme subi et discipline durable.",
        proof_level: 4,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 86,
        confidence_score: 79,
        tags: ["priorites", "arbitrage", "robustesse"],
      },
      {
        key: "d4_i3_amelioration_continue",
        theme: "amelioration continue",
        observed_element:
          "Le mécanisme d’amélioration continue réellement tenable doit être consolidé.",
        managerial_risk:
          "Sans boucle d’amélioration simple et tenue, les progrès restent ponctuels et non capitalisés.",
        instruction_goal: "verify",
        preferred_question:
          "Qu’avez-vous installé ou souhaitez-vous installer pour éviter que les mêmes causes de dérive ne reviennent d’une affaire à l’autre ?",
        prudent_hypothesis:
          "La consolidation suppose une boucle d’apprentissage plus explicite et plus régulière.",
        proof_level: 4,
        allowed_statement_mode: "prudent_hypothesis",
        criticality_score: 79,
        confidence_score: 74,
        tags: ["amelioration_continue", "capitalisation", "boucle"],
      },
    ],
  },
};

function asTemplateFact(
  dimension: FactDimension,
  template: InterviewTemplateFact,
  index: number
): DiagnosticFact {
  const proofLevel = template.proof_level ?? 2;
  const factType: FactType =
    template.fact_type ??
    (dimension === 1
      ? "organisational_fact"
      : dimension === 2
      ? "commercial_fact"
      : dimension === 3
      ? "economic_fact"
      : "operational_fact");

  return {
    id: `TPL-${dimension}-${index + 1}-${template.key}`,
    dimension_primary: dimension,
    dimension_secondary: [],
    fact_type: factType,
    theme: template.theme,
    observed_element: template.observed_element,
    source: "historical_pattern",
    source_excerpt: template.observed_element,
    numeric_values: {},
    tags: template.tags ?? ["template"],
    evidence_kind: proofLevel <= 2 ? "weak_signal" : "explicit_fact",
    proof_level: proofLevel,
    reasoning_status: "to_instruct",
    prudent_hypothesis: template.prudent_hypothesis,
    managerial_risk: template.managerial_risk,
    instruction_goal: template.instruction_goal,
    allowed_statement_mode:
      template.allowed_statement_mode ??
      (proofLevel <= 2
        ? "fact_only"
        : proofLevel === 3
        ? "prudent_hypothesis"
        : "validated_finding"),
    confidence_score: template.confidence_score ?? 60,
    criticality_score: template.criticality_score ?? 70,
    asked_count: 0,
    last_question_at: undefined,
    evidence_refs: [],
    contradiction_notes: [],
  };
}

export function buildSyntheticInterviewFacts(params: {
  dimension: FactDimension;
  iteration: 1 | 2 | 3;
  existingFactIds?: string[];
}): DiagnosticFact[] {
  const templates = INTERVIEW_TEMPLATES[params.dimension]?.[params.iteration] ?? [];
  const existing = new Set(params.existingFactIds ?? []);

  return templates
    .map((template, index) => asTemplateFact(params.dimension, template, index))
    .filter((fact) => !existing.has(fact.id));
}

export function getTemplatePreferredQuestion(
  dimension: FactDimension,
  iteration: 1 | 2 | 3,
  theme: string
): string | null {
  const templates = INTERVIEW_TEMPLATES[dimension]?.[iteration] ?? [];
  const found = templates.find(
    (item) => item.theme.trim().toLowerCase() === theme.trim().toLowerCase()
  );
  return found?.preferred_question ?? null;
}