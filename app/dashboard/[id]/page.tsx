import ChatPanel from "./ChatPanel";
import TrameUploadForm from "./TrameUploadForm";

type Props = {
  params: Promise<{
    id: string;
  }>;
};

export default async function DiagnosticSessionPage({ params }: Props) {
  const { id: sessionId } = await params;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Diagnostic d’entreprise</h1>
        <p className="text-sm text-gray-600 mt-1">Session : {sessionId}</p>
      </div>

      <TrameUploadForm sessionId={sessionId} />

      <ChatPanel sessionId={sessionId} />
    </div>
  );
}