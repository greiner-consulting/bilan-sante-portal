"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type StructuredQuestion = {
  fact_id?: string;
  theme?: string;
  constat: string;
  risque_managerial: string;
  question: string;
};

type FinalObjective = {
  id: string;
  dimensionId: number;
  objectiveLabel: string;
  owner: string;
  keyIndicator: string;
  dueDate: string;
  potentialGain: string;
  gainHypotheses: string[];
  validationStatus: "proposed" | "validated" | "adjusted" | "refused";
  quickWin: string;
};

type FinalObjectiveSet = {
  header: string;
  objectives: FinalObjective[];
  decisionsCapturedAt?: string;
};

type FrozenDimension = {
  dimensionId: number;
  score: number;
  consolidatedFindings: [string, string, string];
  dominantRootCause: string;
  unmanagedZones: Array<{
    constat: string;
    risqueManagerial: string;
    consequence: string;
  }>;
  frozenAt: string;
};

type DisplayMessage = {
  role: "assistant" | "user" | "system";
  text: string;
};

type SessionState = {
  id: string;
  user_id?: string;
  status?: string;
  phase?: string;
  dimension?: number | null;
  iteration?: number | null;
  question_index?: number;
  trame_pdf_path?: string | null;
  has_trame_index?: boolean;
  has_extracted_text?: boolean;
};

type AssistantResponse = {
  assistant_message: string;
  questions: StructuredQuestion[];
  needs_validation: boolean;
  session?: SessionState;
};

type AnswerApiResponse = {
  ok: boolean;
  assistant_message?: string;
  questions?: StructuredQuestion[];
  needs_validation?: boolean;
  session?: SessionState;
  assistant?: AssistantResponse;
  error?: string;
};

type ContextApiResponse = {
  ok: boolean;
  session?: SessionState;
  engine_state?: {
    question_batch_json?: StructuredQuestion[];
    final_objectives_json?: FinalObjectiveSet | null;
    consolidation_json?: FrozenDimension[];
    bilan_state_json?: unknown;
  };
  error?: string;
};

type BuildReportApiResponse = {
  ok: boolean;
  report?: unknown;
  compliance?: {
    ok: boolean;
    warnings?: Array<{ code?: string; message?: string } | string>;
    summary?: string[];
  };
  blocking_issues?: Array<{ code?: string; message?: string }>;
  warnings?: Array<{ code?: string; message?: string }>;
  summary?: string[];
  error?: string;
};

type Props = {
  sessionId: string;
};

function initialAssistantMessage() {
  return "Le diagnostic démarrera automatiquement dès qu’une trame exploitable sera disponible.";
}

function clampIndex(index: number, total: number) {
  if (total <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(index, total - 1));
}

function cleanPrefixedLabel(value: string, label: string) {
  const text = String(value || "").trim();
  const lower = text.toLowerCase();
  const prefix = `${label.toLowerCase()} :`;

  if (lower.startsWith(prefix)) {
    return text.slice(prefix.length).trim();
  }

  return text;
}

function normalizeAssistantResponse(data: AnswerApiResponse): AssistantResponse | null {
  if (data.assistant) {
    return {
      assistant_message: String(data.assistant.assistant_message ?? "").trim(),
      questions: Array.isArray(data.assistant.questions) ? data.assistant.questions : [],
      needs_validation: Boolean(data.assistant.needs_validation),
      session: data.assistant.session,
    };
  }

  if (
    typeof data.assistant_message !== "undefined" ||
    typeof data.questions !== "undefined" ||
    typeof data.needs_validation !== "undefined"
  ) {
    return {
      assistant_message: String(data.assistant_message ?? "").trim(),
      questions: Array.isArray(data.questions) ? data.questions : [],
      needs_validation: Boolean(data.needs_validation),
      session: data.session,
    };
  }

  return null;
}

function phaseLabel(phase?: string | null) {
  switch (phase) {
    case "awaiting_trame":
      return "En attente de trame";
    case "dimension_iteration":
      return "Questions en cours";
    case "iteration_validation":
      return "Validation d’itération";
    case "final_objectives_validation":
      return "Validation des objectifs";
    case "report_ready":
      return "Rapport prêt à construire";
    case "completed":
      return "Terminée";
    default:
      return phase ?? "n/a";
  }
}

function dimensionLabel(dimension?: number | null) {
  switch (dimension) {
    case 1:
      return "1 — Organisation & RH";
    case 2:
      return "2 — Commercial & Marchés";
    case 3:
      return "3 — Cycle de vente & Prix";
    case 4:
      return "4 — Exécution & Performance opérationnelle";
    default:
      return "n/a";
  }
}

function iterationLabel(iteration?: number | null) {
  if (!iteration) return "n/a";
  return `${iteration}/3`;
}

function buildPlaceholder(params: {
  currentQuestion: StructuredQuestion | null;
  awaitingValidation: boolean;
  phase?: string | null;
}) {
  if (params.phase === "final_objectives_validation") {
    return 'Exemple : 1: validé | 2: refusé | 3: ajusté | objectif=... | indicateur=...';
  }

  if (params.currentQuestion) {
    return "Votre réponse à la question affichée...";
  }

  if (params.awaitingValidation) {
    return 'Répondez "oui" ou "non"...';
  }

  if (params.phase === "report_ready") {
    return "Le protocole est terminé. Vous pouvez construire le rapport.";
  }

  return "Votre réponse...";
}

function stringifyReportPreview(report: unknown): string {
  try {
    return JSON.stringify(report, null, 2);
  } catch {
    return "Rapport généré.";
  }
}

export default function ChatPanel({ sessionId }: Props) {
  const [messages, setMessages] = useState<DisplayMessage[]>([
    {
      role: "assistant",
      text: initialAssistantMessage(),
    },
  ]);

  const [questions, setQuestions] = useState<StructuredQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [awaitingValidation, setAwaitingValidation] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [buildingReport, setBuildingReport] = useState(false);
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [finalObjectives, setFinalObjectives] = useState<FinalObjectiveSet | null>(null);
  const [frozenDimensions, setFrozenDimensions] = useState<FrozenDimension[]>([]);
  const [reportPreview, setReportPreview] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const didBootstrapRef = useRef(false);

  const currentQuestion = useMemo(() => {
    if (questions.length === 0) return null;
    return questions[clampIndex(currentIndex, questions.length)] ?? null;
  }, [questions, currentIndex]);

  function pushMessage(role: DisplayMessage["role"], text: string) {
    const content = String(text || "").trim();
    if (!content) return;
    setMessages((prev) => [...prev, { role, text: content }]);
  }

  function resetQuestionState() {
    setQuestions([]);
    setCurrentIndex(0);
  }

  function applyAssistantPayload(
    assistant?: AssistantResponse | null,
    nextSession?: SessionState | null
  ) {
    if (!assistant) return;

    const assistantMessage = String(assistant.assistant_message ?? "").trim();
    const nextQuestions = Array.isArray(assistant.questions) ? assistant.questions : [];
    const needsValidation = Boolean(assistant.needs_validation);

    if (assistantMessage) {
      pushMessage("assistant", assistantMessage);
    }

    if (nextQuestions.length > 0) {
      const nextIndex = clampIndex(
        Number(nextSession?.question_index ?? 0),
        nextQuestions.length
      );

      setQuestions([...nextQuestions]);
      setCurrentIndex(nextIndex);
      setAwaitingValidation(false);
      return;
    }

    resetQuestionState();
    setAwaitingValidation(needsValidation);
  }

  async function loadContext() {
    setBootstrapping(true);

    try {
      const res = await fetch(`/api/session/context?id=${sessionId}`, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      });

      const data: ContextApiResponse = await res.json();

      if (!data.ok) {
        throw new Error(data.error || "Erreur de chargement du contexte");
      }

      if (data.session) {
        setSessionState(data.session);
      }

      const nextQuestions = Array.isArray(data.engine_state?.question_batch_json)
        ? data.engine_state?.question_batch_json ?? []
        : [];

      if (nextQuestions.length > 0) {
        const nextIndex = clampIndex(
          Number(data.session?.question_index ?? 0),
          nextQuestions.length
        );
        setQuestions([...nextQuestions]);
        setCurrentIndex(nextIndex);
      } else {
        resetQuestionState();
      }

      setFinalObjectives(
        data.engine_state?.final_objectives_json &&
          typeof data.engine_state.final_objectives_json === "object"
          ? (data.engine_state.final_objectives_json as FinalObjectiveSet)
          : null
      );

      setFrozenDimensions(
        Array.isArray(data.engine_state?.consolidation_json)
          ? (data.engine_state?.consolidation_json as FrozenDimension[])
          : []
      );

      const phase = String(data.session?.phase ?? "awaiting_trame");

      setAwaitingValidation(
        phase === "iteration_validation" ||
          phase === "final_objectives_validation"
      );
    } catch (e: any) {
      pushMessage(
        "system",
        "Erreur de chargement du contexte : " + (e?.message || "Erreur inconnue")
      );
    } finally {
      setBootstrapping(false);
    }
  }

  async function loadSideStateSilently() {
    try {
      const res = await fetch(`/api/session/context?id=${sessionId}`, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      });

      const data: ContextApiResponse = await res.json();
      if (!data.ok) return;

      if (data.session) {
        setSessionState(data.session);
      }

      setFinalObjectives(
        data.engine_state?.final_objectives_json &&
          typeof data.engine_state.final_objectives_json === "object"
          ? (data.engine_state.final_objectives_json as FinalObjectiveSet)
          : null
      );

      setFrozenDimensions(
        Array.isArray(data.engine_state?.consolidation_json)
          ? (data.engine_state?.consolidation_json as FrozenDimension[])
          : []
      );
    } catch {
      // silence volontaire
    }
  }

  async function sendMessage(message: string) {
    setLoading(true);

    try {
      const payload: Record<string, unknown> = {
        message,
        client_ts: new Date().toISOString(),
      };

      const res = await fetch(`/api/session/${sessionId}/answer`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data: AnswerApiResponse = await res.json();

      if (!data.ok) {
        throw new Error(data.error || "Erreur moteur diagnostic");
      }

      const mergedSession = data.session
        ? {
            ...(sessionState ?? { id: sessionId }),
            ...data.session,
          }
        : sessionState ?? null;

      if (mergedSession) {
        setSessionState(mergedSession);
      }

      const assistant = normalizeAssistantResponse(data);
      applyAssistantPayload(assistant, mergedSession);

      await loadSideStateSilently();
    } catch (e: any) {
      pushMessage("system", "Erreur : " + (e?.message || "Erreur inconnue"));
      resetQuestionState();
      setAwaitingValidation(false);
    } finally {
      setLoading(false);
    }
  }

  async function buildReport() {
    setBuildingReport(true);
    setReportPreview(null);

    try {
      const res = await fetch(`/api/session/${sessionId}/build-report`, {
        method: "POST",
        credentials: "include",
      });

      const data: BuildReportApiResponse = await res.json();

      if (!data.ok) {
        const issues = Array.isArray(data.blocking_issues)
          ? data.blocking_issues
              .map((x) => `[${x.code ?? "ISSUE"}] ${x.message ?? ""}`.trim())
              .join("\n")
          : "";

        throw new Error(
          [data.error || "Erreur build-report", issues].filter(Boolean).join("\n")
        );
      }

      pushMessage(
        "assistant",
        "Le modèle standardisé du rapport a été construit avec succès."
      );

      if (data.compliance?.summary?.length) {
        pushMessage(
          "system",
          "Conformité rapport :\n" + data.compliance.summary.join("\n")
        );
      }

      setReportPreview(stringifyReportPreview(data.report));
    } catch (e: any) {
      pushMessage(
        "system",
        "Erreur lors de la construction du rapport : " +
          (e?.message || "Erreur inconnue")
      );
    } finally {
      setBuildingReport(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading || bootstrapping) return;

    const userText = input.trim();
    if (!userText) return;

    pushMessage("user", userText);
    setInput("");

    await sendMessage(userText);
  }

  useEffect(() => {
    didBootstrapRef.current = false;
    setSessionState(null);
    resetQuestionState();
    setAwaitingValidation(false);
    setFinalObjectives(null);
    setFrozenDimensions([]);
    setReportPreview(null);
    setMessages([
      {
        role: "assistant",
        text: initialAssistantMessage(),
      },
    ]);
  }, [sessionId]);

  useEffect(() => {
    if (didBootstrapRef.current) return;
    didBootstrapRef.current = true;
    loadContext();
  }, [sessionId]);

  useEffect(() => {
    function handleTrameIngested(event: Event) {
      const customEvent = event as CustomEvent<{ sessionId?: string }>;
      if (customEvent.detail?.sessionId !== sessionId) return;

      pushMessage(
        "system",
        "Trame ingérée avec succès. Le contexte de diagnostic est rechargé."
      );

      loadContext();
    }

    window.addEventListener("bilan-trame-ingested", handleTrameIngested);

    return () => {
      window.removeEventListener("bilan-trame-ingested", handleTrameIngested);
    };
  }, [sessionId]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [
    messages,
    currentIndex,
    questions.length,
    awaitingValidation,
    loading,
    finalObjectives,
    frozenDimensions,
  ]);

  useEffect(() => {
    if (questions.length === 0) return;
    setCurrentIndex((prev) => clampIndex(prev, questions.length));
  }, [questions]);

  const placeholder = buildPlaceholder({
    currentQuestion,
    awaitingValidation,
    phase: sessionState?.phase,
  });

  const displayConstat = currentQuestion
    ? cleanPrefixedLabel(currentQuestion.constat, "Constat")
    : "";

  const displayRisque = currentQuestion
    ? cleanPrefixedLabel(currentQuestion.risque_managerial, "Risque managérial")
    : "";

  const displayQuestion = currentQuestion
    ? cleanPrefixedLabel(currentQuestion.question, "Question")
    : "";

  const canBuildReport = sessionState?.phase === "report_ready";

  return (
    <div className="space-y-4">
      <div className="border rounded p-4 bg-gray-50">
        <div className="font-semibold mb-2">Protocole Bilan de Santé</div>
        <div className="text-sm text-gray-700">
          {bootstrapping
            ? "Chargement du contexte de diagnostic..."
            : "Le chat suit désormais le protocole 4D : trame, exploration par dimension, validations, gel, objectifs, puis rapport."}
        </div>

        {sessionState && (
          <div className="mt-3 text-xs text-gray-600 space-y-1">
            <div>
              Session : <strong>{sessionState.id}</strong>
            </div>
            <div>
              Statut : <strong>{sessionState.status ?? "n/a"}</strong>
            </div>
            <div>
              Phase : <strong>{phaseLabel(sessionState.phase)}</strong>
            </div>
            <div>
              Dimension : <strong>{dimensionLabel(sessionState.dimension)}</strong>
            </div>
            <div>
              Itération : <strong>{iterationLabel(sessionState.iteration)}</strong>
            </div>
            <div>
              Réponses enregistrées sur l’itération courante :{" "}
              <strong>{sessionState.question_index ?? 0}</strong>
            </div>
          </div>
        )}
      </div>

      {frozenDimensions.length > 0 && (
        <div className="border rounded p-4 bg-white space-y-3">
          <div className="font-semibold">Dimensions gelées</div>

          <div className="grid gap-3">
            {frozenDimensions
              .slice()
              .sort((a, b) => a.dimensionId - b.dimensionId)
              .map((dim) => (
                <div key={dim.dimensionId} className="rounded border p-3 bg-gray-50">
                  <div className="flex items-center justify-between gap-4">
                    <div className="font-medium">
                      {dimensionLabel(dim.dimensionId)}
                    </div>
                    <div className="text-sm">
                      Score : <strong>{dim.score}/5</strong>
                    </div>
                  </div>

                  <div className="mt-2 text-sm">
                    <div className="font-medium">Cause racine dominante</div>
                    <div>{dim.dominantRootCause}</div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {finalObjectives?.objectives?.length ? (
        <div className="border rounded p-4 bg-white space-y-3">
          <div className="font-semibold">
            {finalObjectives.header || "Objectifs finaux"}
          </div>

          <div className="grid gap-3">
            {finalObjectives.objectives.map((objective, index) => (
              <div key={objective.id} className="rounded border p-3 bg-gray-50 space-y-2">
                <div className="font-medium">
                  {index + 1}. {objective.objectiveLabel}
                </div>
                <div className="text-sm text-gray-700">
                  <div>
                    <span className="font-medium">Dimension :</span>{" "}
                    {dimensionLabel(objective.dimensionId)}
                  </div>
                  <div>
                    <span className="font-medium">Indicateur :</span>{" "}
                    {objective.keyIndicator}
                  </div>
                  <div>
                    <span className="font-medium">Échéance :</span>{" "}
                    {objective.dueDate}
                  </div>
                  <div>
                    <span className="font-medium">Statut :</span>{" "}
                    {objective.validationStatus}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {sessionState?.phase === "final_objectives_validation" && (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Validez les objectifs par chat. Vous pouvez répondre simplement{" "}
              <strong>oui</strong>, ou détailler objectif par objectif.
            </div>
          )}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className="border rounded p-4 max-h-[380px] overflow-y-auto space-y-3 bg-white"
      >
        {messages.map((m, i) => {
          const isUser = m.role === "user";
          const isSystem = m.role === "system";

          return (
            <div
              key={i}
              className={[
                "whitespace-pre-line rounded p-3",
                isUser
                  ? "bg-black text-white ml-8"
                  : isSystem
                    ? "bg-red-50 text-red-700"
                    : "bg-gray-50 mr-8",
              ].join(" ")}
            >
              {m.text}
            </div>
          );
        })}
      </div>

      {currentQuestion && (
        <div className="border rounded p-4 bg-gray-50 space-y-4">
          <div className="flex items-center justify-between text-sm">
            <div className="font-semibold">
              Dimension {sessionState?.dimension ?? "?"} — Itération{" "}
              {sessionState?.iteration ?? "?"}/3
            </div>
            <div>
              Question {Math.min(currentIndex + 1, questions.length)} / {questions.length}
            </div>
          </div>

          {currentQuestion.theme && (
            <div className="text-xs text-gray-500">
              Thème : {currentQuestion.theme}
            </div>
          )}

          <div className="border rounded bg-white p-4 space-y-3">
            <div>
              <span className="font-semibold">Constat : </span>
              {displayConstat}
            </div>
            <div>
              <span className="font-semibold">Risque managérial : </span>
              {displayRisque}
            </div>
            <div>
              <span className="font-semibold">Question : </span>
              {displayQuestion}
            </div>
          </div>
        </div>
      )}

      {!currentQuestion && awaitingValidation && (
        <div className="border rounded p-4 bg-gray-50">
          <div className="font-semibold mb-2">
            {sessionState?.phase === "final_objectives_validation"
              ? "Validation des objectifs"
              : "Validation d’itération"}
          </div>
          <div className="text-sm text-gray-700">
            {sessionState?.phase === "final_objectives_validation" ? (
              <>
                Répondez par <strong>oui</strong> pour tout valider, ou détaillez
                objectif par objectif.
              </>
            ) : (
              <>
                Répondez simplement par <strong>oui</strong> ou <strong>non</strong>.
              </>
            )}
          </div>
        </div>
      )}

      {canBuildReport && (
        <div className="border rounded p-4 bg-white space-y-3">
          <div className="font-semibold">Rapport standardisé</div>
          <div className="text-sm text-gray-700">
            Le protocole est terminé. Vous pouvez maintenant construire le modèle
            standardisé du rapport dirigeant.
          </div>

          <button
            type="button"
            onClick={buildReport}
            disabled={buildingReport}
            className="bg-black text-white px-4 py-2 rounded disabled:opacity-50"
          >
            {buildingReport ? "Construction..." : "Construire le rapport"}
          </button>
        </div>
      )}

      {reportPreview && (
        <div className="border rounded p-4 bg-white space-y-2">
          <div className="font-semibold">Aperçu JSON du rapport</div>
          <pre className="text-xs overflow-x-auto whitespace-pre-wrap bg-gray-50 p-3 rounded border">
            {reportPreview}
          </pre>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          className="border rounded px-3 py-2 flex-1"
          placeholder={placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading || bootstrapping || canBuildReport}
        />

        <button
          type="submit"
          disabled={
            loading ||
            bootstrapping ||
            canBuildReport ||
            input.trim().length === 0
          }
          className="bg-black text-white px-4 py-2 rounded disabled:opacity-50"
        >
          {loading ? "Envoi..." : bootstrapping ? "Chargement..." : "Envoyer"}
        </button>
      </form>
    </div>
  );
}