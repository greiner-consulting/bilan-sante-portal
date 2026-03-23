import { adminSupabase } from "@/lib/supabaseServer";
import { buildExecutiveSummary } from "@/lib/diagnostic/buildExecutiveSummary";

export type DiagnosticReport = {
  session_id: string;
  score_global: number;
  niveau_global: string;
  forces: string[];
  faiblesses: string[];
  priorites: string[];
  synthese: string;
  dimensions: any[];
};

export async function buildReport(sessionId: string): Promise<DiagnosticReport> {

  const admin = adminSupabase();

  // récupérer les scores par dimension
  const { data: scores, error } = await admin
    .from("diagnostic_scores")
    .select("*")
    .eq("session_id", sessionId)
    .order("dimension");

  if (error) {
    throw new Error(error.message);
  }

  // construire la synthèse dirigeant
  const executive = await buildExecutiveSummary(sessionId);

  const report: DiagnosticReport = {
    session_id: sessionId,
    score_global: executive.score_global,
    niveau_global: executive.niveau_global,
    forces: executive.forces,
    faiblesses: executive.faiblesses,
    priorites: executive.priorites,
    synthese: executive.synthese,
    dimensions: scores ?? []
  };

  // stocker le rapport
  const { error: insertError } = await admin
    .from("diagnostic_reports")
    .insert({
      session_id: sessionId,
      report_json: report
    });

  if (insertError) {
    throw new Error(insertError.message);
  }

  return report;
}