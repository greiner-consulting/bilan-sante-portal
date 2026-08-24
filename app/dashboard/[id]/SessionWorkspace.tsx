import BrandMark from "./BrandMark";
import DialogueDiagnosticPanel from "./DialogueDiagnosticPanel";
import { DIAGNOSTIC_JOURNEY_STEPS } from "@/lib/diagnostic/conversationProtocol";

type Props = {
  sessionId: string;
};

const DIAGNOSTIC_DOMAINS = [
  "Contexte — Histoire & résultats",
  "Organisation & RH",
  "Commercial & Marchés",
  "Cycle de vente & Prix",
  "Exécution & Performance opérationnelle",
] as const;

export default function SessionWorkspace({ sessionId }: Props) {
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-3">
            <BrandMark />
            <p className="max-w-3xl text-sm leading-6 text-slate-700">
              Le diagnostic est conduit sous forme d’un entretien structuré avec l’IA.
              L’IA analyse la matière communiquée, identifie les points d’étonnement et
              approfondit progressivement le diagnostic. L’application garantit le
              respect de la méthode, le séquencement et la traçabilité des échanges.
            </p>
          </div>

          <div className="max-w-sm rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
            <div className="font-medium text-slate-900">Principe de travail</div>
            <div className="mt-1">
              Vous répondez librement. Les informations disponibles, les écarts, les
              incohérences et les données non suivies alimentent ensuite les questions
              du consultant IA.
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-6 self-start xl:sticky xl:top-6">
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Domaines du diagnostic
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                L’entretien commence par la trajectoire de l’entreprise, puis couvre les
                quatre domaines opérationnels.
              </p>
            </div>

            <ul className="space-y-2 text-sm text-slate-700">
              {DIAGNOSTIC_DOMAINS.map((item, index) => (
                <li
                  key={item}
                  className="flex gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5"
                >
                  <span className="min-w-6 font-semibold text-slate-900">
                    {index}.
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Parcours du diagnostic
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                L’application contrôle l’enchaînement ; l’IA conduit l’entretien et les
                approfondissements.
              </p>
            </div>

            <ol className="space-y-2 text-sm text-slate-700">
              {DIAGNOSTIC_JOURNEY_STEPS.map((step, index) => (
                <li
                  key={step}
                  className="flex gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5"
                >
                  <span className="min-w-6 font-semibold text-slate-900">
                    {index + 1}.
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </section>
        </aside>

        <main className="min-w-0 space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-slate-900">
                Entretien de diagnostic
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Commencez directement par le dialogue. Aucun document préalable n’est
                nécessaire pour engager le diagnostic.
              </p>
            </div>

            <DialogueDiagnosticPanel sessionId={sessionId} />
          </section>
        </main>
      </div>
    </div>
  );
}
