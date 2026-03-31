import JSZip from "jszip";
import type { PreviewSection, StandardDiagnosticReport } from "@/lib/bilan-sante/report-builder";

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function paragraphRunsXml(text: string): string {
  const lines = normalizeText(text).split("\n");
  const safeLines = lines.length > 0 ? lines : [""];

  return safeLines
    .map((line, index) => {
      const escaped = xmlEscape(line);
      if (index === 0) return `<w:r><w:t xml:space="preserve">${escaped}</w:t></w:r>`;
      return `<w:r><w:br/></w:r><w:r><w:t xml:space="preserve">${escaped}</w:t></w:r>`;
    })
    .join("");
}

function paragraphXml(
  text: string,
  style = "BodyText",
  opts?: { pageBreakBefore?: boolean }
): string {
  return `
    <w:p>
      <w:pPr>
        <w:pStyle w:val="${style}"/>
        ${opts?.pageBreakBefore ? '<w:pageBreakBefore/>' : ""}
      </w:pPr>
      ${paragraphRunsXml(text)}
    </w:p>
  `;
}

function bulletParagraphXml(text: string): string {
  return `
    <w:p>
      <w:pPr>
        <w:pStyle w:val="BodyText"/>
        <w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>
      </w:pPr>
      ${paragraphRunsXml(text)}
    </w:p>
  `;
}

function pageBreakXml(): string {
  return `
    <w:p>
      <w:r><w:br w:type="page"/></w:r>
    </w:p>
  `;
}

function tableCellXml(text: string, widthPct: number, header = false): string {
  const safeWidth = Math.max(5, Math.min(95, widthPct));
  const paragraphs = normalizeText(text)
    .split("\n")
    .filter((line, index, arr) => Boolean(line.trim()) || arr.length === 1)
    .map((line) => paragraphXml(line || "", header ? "TableHeaderText" : "TableBodyText"))
    .join("");

  return `
    <w:tc>
      <w:tcPr>
        <w:tcW w:w="${safeWidth * 50}" w:type="pct"/>
        ${header ? '<w:shd w:val="clear" w:fill="E5E7EB"/>' : ""}
        <w:vAlign w:val="top"/>
      </w:tcPr>
      ${paragraphs}
    </w:tc>
  `;
}

function tableXml(params: {
  title?: string;
  headers: string[];
  rows: string[][];
  pageBreakBefore?: boolean;
}): string {
  const { title, headers, rows, pageBreakBefore } = params;
  const widthPct = headers.length > 0 ? Math.floor(100 / headers.length) : 100;
  const headerRow = `
    <w:tr>
      ${headers.map((header) => tableCellXml(header, widthPct, true)).join("")}
    </w:tr>
  `;

  const bodyRows = rows.length > 0
    ? rows
        .map(
          (row) => `
            <w:tr>
              ${headers
                .map((_, index) => tableCellXml(row[index] ?? "", widthPct, false))
                .join("")}
            </w:tr>
          `
        )
        .join("")
    : `
      <w:tr>
        ${headers.map((_, index) => tableCellXml(index === 0 ? "—" : "", widthPct, false)).join("")}
      </w:tr>
    `;

  return `
    ${title ? paragraphXml(title, "Heading3", { pageBreakBefore }) : pageBreakBefore ? pageBreakXml() : ""}
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="5000" w:type="pct"/>
        <w:tblLayout w:type="fixed"/>
        <w:tblBorders>
          <w:top w:val="single" w:sz="8" w:space="0" w:color="C7CBD1"/>
          <w:left w:val="single" w:sz="8" w:space="0" w:color="C7CBD1"/>
          <w:bottom w:val="single" w:sz="8" w:space="0" w:color="C7CBD1"/>
          <w:right w:val="single" w:sz="8" w:space="0" w:color="C7CBD1"/>
          <w:insideH w:val="single" w:sz="6" w:space="0" w:color="D1D5DB"/>
          <w:insideV w:val="single" w:sz="6" w:space="0" w:color="D1D5DB"/>
        </w:tblBorders>
      </w:tblPr>
      ${headerRow}
      ${bodyRows}
    </w:tbl>
  `;
}

function previewSectionToXml(section: PreviewSection, index: number): string {
  const out: string[] = [];
  out.push(paragraphXml(section.title, "Heading1", { pageBreakBefore: index > 0 }));

  for (const paragraph of section.paragraphs ?? []) {
    if (paragraph.trim()) out.push(paragraphXml(paragraph, "BodyText"));
  }

  for (const bullet of section.bullets ?? []) {
    if (bullet.trim()) out.push(bulletParagraphXml(bullet));
  }

  for (const table of section.tables ?? []) {
    out.push(
      tableXml({
        title: table.title,
        headers: table.headers,
        rows: table.rows,
      })
    );
  }

  return out.join("\n");
}

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/>
        <w:sz w:val="22"/>
        <w:szCs w:val="22"/>
        <w:lang w:val="fr-FR"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="120"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:after="260"/></w:pPr>
    <w:rPr><w:b/><w:color w:val="111827"/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="BodyText"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="220" w:after="120"/></w:pPr>
    <w:rPr><w:b/><w:color w:val="111827"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="BodyText"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="160" w:after="80"/></w:pPr>
    <w:rPr><w:b/><w:color w:val="374151"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="120" w:after="60"/></w:pPr>
    <w:rPr><w:b/><w:color w:val="1F2937"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="BodyText">
    <w:name w:val="Body Text"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:after="96"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="TableHeaderText">
    <w:name w:val="Table Header Text"/>
    <w:basedOn w:val="BodyText"/>
    <w:rPr><w:b/><w:color w:val="111827"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="TableBodyText">
    <w:name w:val="Table Body Text"/>
    <w:basedOn w:val="BodyText"/>
    <w:pPr><w:spacing w:after="48"/></w:pPr>
  </w:style>
</w:styles>`;

const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="bullet"/>
      <w:lvlText w:val="•"/>
      <w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
      <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/></w:rPr>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

export async function buildDiagnosticDocxBuffer(report: StandardDiagnosticReport): Promise<Buffer> {
  const previewSections: PreviewSection[] = [
    {
      id: "cover",
      title: report.title,
      paragraphs: [
        `Généré le ${report.generatedAt}`,
        `Entreprise : ${report.identificationPage.companyLabel}`,
        `Dirigeant : ${report.identificationPage.dirigeantLabel}`,
      ],
    },
    {
      id: "identification",
      title: report.identificationPage.title,
      paragraphs: [report.identificationPage.note],
      tables: [
        {
          headers: ["Champ", "Valeur"],
          rows: [
            ["Session", report.identificationPage.sessionId],
            ["Date de génération", report.identificationPage.generatedAt],
            ["Entreprise", report.identificationPage.companyLabel],
            ["Dirigeant", report.identificationPage.dirigeantLabel],
          ],
        },
      ],
    },
    ...reportToPreviewSections(report),
  ];

  const body = previewSections
    .map((section, index) => previewSectionToXml(section, index))
    .join("\n");

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
    xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
    xmlns:o="urn:schemas-microsoft-com:office:office"
    xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
    xmlns:v="urn:schemas-microsoft-com:vml"
    xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
    xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
    xmlns:w10="urn:schemas-microsoft-com:office:word"
    xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
    xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
    xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk"
    xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
    xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
    mc:Ignorable="w14 wp14">
    <w:body>
      ${body}
      <w:sectPr>
        <w:pgSz w:w="11906" w:h="16838"/>
        <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/>
      </w:sectPr>
    </w:body>
  </w:document>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
    <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
    <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
    <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  </Types>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
    <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
  </Relationships>`;

  const documentRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
    <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
  </Relationships>`;

  const now = new Date().toISOString();
  const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:dcterms="http://purl.org/dc/terms/"
    xmlns:dcmitype="http://purl.org/dc/dcmitype/"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <dc:title>${xmlEscape(report.title)}</dc:title>
    <dc:creator>ChatGPT</dc:creator>
    <cp:lastModifiedBy>ChatGPT</cp:lastModifiedBy>
    <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
    <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
  </cp:coreProperties>`;

  const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
    xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
    <Application>ChatGPT</Application>
  </Properties>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypesXml);
  zip.folder("_rels")?.file(".rels", relsXml);
  zip.folder("docProps")?.file("core.xml", coreXml);
  zip.folder("docProps")?.file("app.xml", appXml);
  zip.folder("word")?.file("document.xml", documentXml);
  zip.folder("word")?.file("styles.xml", stylesXml);
  zip.folder("word")?.file("numbering.xml", numberingXml);
  zip.folder("word")?.folder("_rels")?.file("document.xml.rels", documentRelsXml);

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function reportToPreviewSections(report: StandardDiagnosticReport): PreviewSection[] {
  const sections: PreviewSection[] = [];

  sections.push({
    id: "executive-summary",
    title: report.executiveSummaryPage0.title,
    paragraphs: [report.executiveSummaryPage0.synthesis],
    bullets: [
      `Score global : ${report.executiveSummaryPage0.globalScore}/5`,
      `Niveau global : ${report.executiveSummaryPage0.globalLevel}`,
      `Enjeu majeur : ${report.executiveSummaryPage0.majorIssue}`,
    ],
    tables: [
      {
        title: "Lecture dirigeant",
        headers: ["Points d’appui consolidés", "Vulnérabilités prioritaires"],
        rows: Array.from({
          length: Math.max(
            report.executiveSummaryPage0.keyStrengths.length,
            report.executiveSummaryPage0.keyVulnerabilities.length
          ),
        }).map((_, index) => [
          report.executiveSummaryPage0.keyStrengths[index] ?? "",
          report.executiveSummaryPage0.keyVulnerabilities[index] ?? "",
        ]),
      },
      {
        title: "Objectifs structurants proposés",
        headers: ["Objectif"],
        rows: report.executiveSummaryPage0.priorityObjectives.map((item) => [item]),
      },
    ],
  });

  sections.push({
    id: "input-history",
    title: report.inputHistory.title,
    bullets: report.inputHistory.inputRules,
    tables: [
      {
        title: "Qualité de trame",
        headers: ["Flags qualité", "Champs non suivis / absents"],
        rows: Array.from({
          length: Math.max(
            report.inputHistory.trameQualityFlags.length || 1,
            report.inputHistory.missingFieldSignals.length || 1
          ),
        }).map((_, index) => [
          report.inputHistory.trameQualityFlags[index] ?? "",
          report.inputHistory.missingFieldSignals[index] ?? "",
        ]),
      },
    ],
  });

  for (const dimension of report.dimensionDiagnostics) {
    sections.push({
      id: `dimension-${dimension.dimensionId}`,
      title: `${dimension.title} — score ${dimension.score}/5`,
      paragraphs: [
        dimension.summary ?? "",
        `Cause racine dominante : ${dimension.dominantRootCause}`,
      ].filter(Boolean),
      tables: [
        {
          title: "Constats consolidés",
          headers: ["#", "Constat"],
          rows: dimension.consolidatedFindings.map((item, index) => [`${index + 1}`, item]),
        },
        ...(dimension.evidenceSummary && dimension.evidenceSummary.length > 0
          ? [
              {
                title: "Éléments de matière consolidés",
                headers: ["Élément"],
                rows: dimension.evidenceSummary.map((item) => [item]),
              },
            ]
          : []),
        ...dimension.unmanagedZoneTables.map((table) => ({
          title: table.title,
          headers: ["Champ", "Contenu"],
          rows: table.rows.map((row) => [row.label, row.value]),
        })),
        {
          title: "SWOT",
          headers: ["Points d’appui", "Faiblesses", "Opportunités", "Risques"],
          rows: Array.from({
            length: Math.max(
              dimension.swot.forces.length,
              dimension.swot.faiblesses.length,
              dimension.swot.opportunites.length,
              dimension.swot.risques.length
            ),
          }).map((_, index) => [
            dimension.swot.forces[index] ?? "",
            dimension.swot.faiblesses[index] ?? "",
            dimension.swot.opportunites[index] ?? "",
            dimension.swot.risques[index] ?? "",
          ]),
        },
      ],
    });
  }

  sections.push({
    id: "transverse-zones",
    title: report.transverseUnmanagedZones.title,
    tables: report.transverseUnmanagedZones.tables.map((table) => ({
      title: table.title,
      headers: ["Champ", "Contenu"],
      rows: table.rows.map((row) => [row.label, row.value]),
    })),
  });

  sections.push({
    id: "action-plan",
    title: report.actionPlanCards.title,
    tables: [
      {
        title: "Synthèse des objectifs de résultat",
        headers: ["Dimension", "Objectif de résultat", "Indicateur", "Échéance", "Statut"],
        rows: report.actionPlanCards.cards.map((card) => {
          const map = new Map(card.rows.map((row) => [row.label, row.value]));
          return [
            card.title.replace(/^Carte objectif\s+—\s+/, ""),
            map.get("Objectif de résultat") ?? "",
            map.get("Indicateur clé") ?? "",
            map.get("Échéance") ?? "",
            map.get("Statut validation dirigeant") ?? "",
          ];
        }),
      },
      ...report.actionPlanCards.cards.map((card) => ({
        title: card.title,
        headers: ["Champ", "Contenu"],
        rows: card.rows.map((row) => [row.label, row.value]),
      })),
    ],
  });

  sections.push({
    id: "leader-conclusion",
    title: report.leaderConclusion.title,
    paragraphs: [report.leaderConclusion.closingStatement],
    tables: [
      {
        title: "Lecture transverse",
        headers: ["Alignements", "Désalignements", "Contradictions", "Impacts globaux"],
        rows: Array.from({
          length: Math.max(
            report.leaderConclusion.alignments.length || 1,
            report.leaderConclusion.misalignments.length || 1,
            report.leaderConclusion.contradictions.length || 1,
            report.leaderConclusion.globalImpacts.length || 1
          ),
        }).map((_, index) => [
          report.leaderConclusion.alignments[index] ?? "",
          report.leaderConclusion.misalignments[index] ?? "",
          report.leaderConclusion.contradictions[index] ?? "",
          report.leaderConclusion.globalImpacts[index] ?? "",
        ]),
      },
    ],
  });

  sections.push({
    id: "confidentiality",
    title: report.confidentiality.title,
    bullets: report.confidentiality.rules,
  });

  sections.push({
    id: "compliance",
    title: report.complianceChecklist.title,
    bullets: [
      `Conforme : ${report.complianceChecklist.isCompliant ? "oui" : "non"}`,
      ...report.complianceChecklist.summary,
      ...report.complianceChecklist.warnings,
    ],
  });

  return sections;
}
