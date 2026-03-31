import ChatPanel from "./ChatPanel";
import BrandMark from "./BrandMark";
import TrameUploadForm from "./TrameUploadForm";

type Props = {
  sessionId: string;
};

const DIMENSIONS = [
  "1. Organisation & RH",
  "2. Commercial & Marchés",
  "3. Cycle de vente & Prix",
  "4. Exécution & Performance opérationnelle",
] as const;

const FLOW_STEPS = [
  "Upload d’une trame DOCX",
  "Extraction de la matière de base",
  "Démarrage du protocole dirigeant",
  "3 itérations par dimension",
  "Validations intermédiaires",
  "Gel de chaque dimension",
  "Validation des objectifs finaux",
  "Construction du rapport",
] as const;

export default function SessionWorkspace({ sessionId }: Props) {
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-3">
            <BrandMark />
            <p className="max-w-3xl text-sm leading-6 text-slate-700">
              Cet espace pilote le protocole 4D complet : ingestion de la trame,
              exploration progressive, consolidation par dimension, gel, objectifs finaux
              puis préparation du rapport dirigeant.
            </p>
          </div>

          <div className="max-w-sm rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
            <div className="font-medium text-slate-900">Principe de travail</div>
            <div className="mt-1">
              On privilégie d’abord la qualité de la matière collectée, puis sa
              consolidation métier. L’interface reste simple ; la profondeur vient du
              moteur de diagnostic.
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-6 self-start xl:sticky xl:top-6">
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Chargement de la trame
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Déposez ici la trame DOCX de référence qui sert de base au protocole.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <TrameUploadForm sessionId={sessionId} />
            </div>
          </section>

          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Dimensions couvertes
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Le protocole explore successivement les 4 axes du diagnostic dirigeant.
              </p>
            </div>

            <ul className="space-y-2 text-sm text-slate-700">
              {DIMENSIONS.map((item) => (
                <li
                  key={item}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5"
                >
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Séquencement du flux
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Le moteur suit un enchaînement structuré, sans rupture avec les routes
                déjà stabilisées.
              </p>
            </div>

            <ol className="space-y-2 text-sm text-slate-700">
              {FLOW_STEPS.map((step, index) => (
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
                Espace de dialogue et de pilotage
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Le panneau ci-dessous orchestre les questions, validations, dimensions
                gelées, objectifs finaux et la construction du rapport.
              </p>
            </div>

            <ChatPanel sessionId={sessionId} />
          </section>
        </main>
      </div>
    </div>
  );
}
