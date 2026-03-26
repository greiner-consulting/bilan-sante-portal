import SessionWorkspace from "./SessionWorkspace";

type Props = {
  params: Promise<{
    id: string;
  }>;
};

export default async function DiagnosticSessionPage({ params }: Props) {
  const { id: sessionId } = await params;

  return <SessionWorkspace sessionId={sessionId} />;
}