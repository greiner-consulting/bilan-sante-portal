"use client";

import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer
} from "recharts";

type Props = {
  report: any;
};

export default function DiagnosticDashboard({ report }: Props) {

  const radarData =
    report?.dimensions?.map((d: any) => ({
      dimension: `D${d.dimension}`,
      score: d.score
    })) ?? [];

  return (
    <div className="space-y-8">

      {/* Score global */}
      <div className="p-6 border rounded-xl">
        <h2 className="text-xl font-semibold mb-2">
          Diagnostic stratégique
        </h2>

        <div className="text-3xl font-bold">
          Score global : {report.score_global}/5
        </div>

        <div className="text-gray-600">
          Niveau : {report.niveau_global}
        </div>
      </div>

      {/* Radar */}
      <div className="p-6 border rounded-xl">
        <h3 className="text-lg font-semibold mb-4">
          Radar stratégique
        </h3>

        <div style={{ width: "100%", height: 300 }}>
          <ResponsiveContainer>
            <RadarChart data={radarData}>
              <PolarGrid />
              <PolarAngleAxis dataKey="dimension" />
              <PolarRadiusAxis domain={[0, 5]} />
              <Radar
                dataKey="score"
                stroke="#000"
                fill="#000"
                fillOpacity={0.3}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Forces */}
      <div className="p-6 border rounded-xl">
        <h3 className="font-semibold mb-2">
          Forces
        </h3>

        <ul className="list-disc pl-6">
          {report.forces?.map((f: string, i: number) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      </div>

      {/* Faiblesses */}
      <div className="p-6 border rounded-xl">
        <h3 className="font-semibold mb-2">
          Faiblesses
        </h3>

        <ul className="list-disc pl-6">
          {report.faiblesses?.map((f: string, i: number) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      </div>

      {/* Priorités */}
      <div className="p-6 border rounded-xl">
        <h3 className="font-semibold mb-2">
          Priorités dirigeant
        </h3>

        <ul className="list-disc pl-6">
          {report.priorites?.map((p: string, i: number) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      </div>

      {/* Synthèse */}
      <div className="p-6 border rounded-xl">
        <h3 className="font-semibold mb-2">
          Synthèse
        </h3>

        <p className="text-gray-700 leading-relaxed">
          {report.synthese}
        </p>
      </div>

    </div>
  );
}