import PizZip from "pizzip";
import type { ReportV5, ReportDimension, ReportObjective, ReportSwot } from "@/lib/report/reportV5LLM";

function x(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function runs(text: string, bold = false) {
  const parts = String(text ?? "").split("\n");
  return parts
    .map((part, index) => {
      const br = index > 0 ? "<w:br/>" : "";
      return `<w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}${br}<w:t xml:space="preserve">${x(part)}</w:t></w:r>`;
    })
    .join("");
}

function p(
  text = "",
  opts?: {
    style?: string;
    bold?: boolean;
    keepNext?: boolean;
    align?: "left" | "center";
    spaceAfter?: number;
  }
) {
  const pPr = [
    opts?.style ? `<w:pStyle w:val="${x(opts.style)}"/>` : "",
    opts?.keepNext ? "<w:keepNext/>" : "",
    opts?.align === "center" ? '<w:jc w:val="center"/>' : "",
    typeof opts?.spaceAfter === "number"
      ? `<w:spacing w:after="${opts.spaceAfter}"/>`
      : "",
  ].join("");
  return `<w:p><w:pPr>${pPr}</w:pPr>${runs(text, Boolean(opts?.bold))}</w:p>`;
}

function bullet(text: string) {
  return `<w:p><w:pPr><w:ind w:left="360" w:hanging="180"/><w:spacing w:after="80"/></w:pPr><w:r><w:t xml:space="preserve">• ${x(text)}</w:t></w:r></w:p>`;
}

function pageBreak() {
  return `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
}

function cell(content: string, width: number, opts?: { shade?: string; bold?: boolean }) {
  const shade = opts?.shade ? `<w:shd w:fill="${opts.shade}"/>` : "";
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shade}<w:vAlign w:val="center"/></w:tcPr>${p(content, { bold: opts?.bold, spaceAfter: 0 })}</w:tc>`;
}

function table(rows: string[][], widths: number[], header = false) {
  const borders = `<w:tblBorders><w:top w:val="single" w:sz="4" w:color="D6DEE8"/><w:left w:val="single" w:sz="4" w:color="D6DEE8"/><w:bottom w:val="single" w:sz="4" w:color="D6DEE8"/><w:right w:val="single" w:sz="4" w:color="D6DEE8"/><w:insideH w:val="single" w:sz="4" w:color="D6DEE8"/><w:insideV w:val="single" w:sz="4" w:color="D6DEE8"/></w:tblBorders>`;
  const body = rows
    .map((row, r) => {
      const trPr =
        r === 0 && header
          ? "<w:trPr><w:tblHeader/></w:trPr>"
          : "<w:trPr><w:cantSplit/></w:trPr>";
      const cells = row
        .map((value, c) =>
          cell(value, widths[c] ?? widths[widths.length - 1], {
            shade: r === 0 && header ? "EAF0F6" : undefined,
            bold: r === 0 && header,
          })
        )
        .join("");
      return `<w:tr>${trPr}${cells}</w:tr>`;
    })
    .join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="fixed"/>${borders}<w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr>${body}</w:tbl>${p("", { spaceAfter: 80 })}`;
}

function swotTable(swot: ReportSwot) {
  const join = (items: string[]) => items.map((item) => `• ${item}`).join("\n");
  return [
    table(
      [
        ["Forces", "Faiblesses"],
        [join(swot.forces), join(swot.faiblesses)],
      ],
      [4680, 4680],
      true
    ),
    table(
      [
        ["Opportunités", "Risques"],
        [join(swot.opportunites), join(swot.risques)],
      ],
      [4680, 4680],
      true
    ),
  ].join("");
}

function dimensionSection(d: ReportDimension) {
  const zones = d.zones_non_pilotees.length
    ? table(
        [
          ["Constat", "Risque managérial", "Conséquence probable"],
          ...d.zones_non_pilotees.map((z) => [z.constat, z.risque, z.consequence]),
        ],
        [3120, 3120, 3120],
        true
      )
    : p("Aucune zone non pilotée supplémentaire n’a été identifiée dans le diagnostic gelé.");

  return [
    p(d.nom, { style: "Heading2", keepNext: true }),
    p(`Score (1–5) : ${d.score}`, { bold: true }),
    p("Constat consolidé", { style: "Heading3", keepNext: true }),
    ...d.constats.map(bullet),
    p("Cause racine dominante", { style: "Heading3", keepNext: true }),
    p(d.cause_racine),
    p("Zones non pilotées / non formalisées — risques managériaux associés", {
      style: "Heading3",
      keepNext: true,
    }),
    zones,
    p("SWOT", { style: "Heading3", keepNext: true }),
    swotTable(d.swot),
  ].join("");
}

function objectiveCard(o: ReportObjective) {
  return [
    p(`Objectif ${o.id.replace(/^O/i, "")} — ${o.titre}`, {
      style: "Heading3",
      keepNext: true,
    }),
    table(
      [
        ["Objectif de résultat", o.objectif_resultat],
        ["Cause racine adressée", o.cause_racine],
        ["Owner", o.owner || "À confirmer"],
        ["Indicateur clé", o.indicateur_cle || "À confirmer"],
        ["Échéance", o.echeance || "À confirmer"],
        [
          "Gain potentiel",
          o.gain_potentiel ||
            "Non quantifiable avec fiabilité à partir des données disponibles",
        ],
        ["Statut de validation dirigeant", o.statut],
        ["Quick win", o.quick_win || "À définir lors de la mise en œuvre"],
      ],
      [2600, 6760],
      false
    ),
  ].join("");
}

function documentBody(report: ReportV5) {
  const out: string[] = [];

  out.push(
    p("Bilan de Santé – Rapport Dirigeant", { style: "Title", align: "center" }),
    p(report.identification.entreprise || "Entreprise", {
      style: "Subtitle",
      align: "center",
    }),
    p("", { spaceAfter: 200 }),
    table(
      [
        ["Entreprise", report.identification.entreprise],
        ["Dirigeant", report.identification.dirigeant],
        ["Activité", report.identification.activite],
        ["Localisation", report.identification.localisation],
        ["Date", report.identification.date],
      ],
      [2500, 6860]
    ),
    pageBreak()
  );

  out.push(
    p("2. Synthèse exécutive — Page 0", { style: "Heading1", keepNext: true }),
    p("2.1 Situation générale", { style: "Heading2", keepNext: true }),
    p(report.synthese_executive.situation_generale),
    p("2.2 Principaux constats structurants", { style: "Heading2", keepNext: true }),
    ...report.synthese_executive.constats_structurants.map(bullet),
    p("2.3 Zones critiques non pilotées", { style: "Heading2", keepNext: true }),
    ...report.synthese_executive.zones_critiques.map((z) =>
      bullet(`${z.zone} → ${z.risque}`)
    ),
    p("2.4 Enjeux économiques associés", { style: "Heading2", keepNext: true }),
    ...report.synthese_executive.enjeux_economiques.map(bullet),
    p("2.5 Trajectoire de transformation proposée", {
      style: "Heading2",
      keepNext: true,
    }),
    p(report.synthese_executive.trajectoire_transformation),
    p("2.6 Message clé dirigeant", { style: "Heading2", keepNext: true }),
    table([[report.synthese_executive.message_cle]], [9360]),
    pageBreak()
  );

  out.push(
    p("3. Historique & données d’entrée", { style: "Heading1", keepNext: true }),
    p(report.historique.synthese_factuelle),
    p("Données d’entrée", { style: "Heading2", keepNext: true }),
    ...report.historique.donnees_entree.map(bullet),
    pageBreak(),
    p("4. Diagnostic par dimension", { style: "Heading1", keepNext: true })
  );

  report.dimensions.forEach((d, index) => {
    out.push(dimensionSection(d));
    if (index < report.dimensions.length - 1) out.push(pageBreak());
  });

  out.push(
    pageBreak(),
    p("5. Synthèse transverse des zones non pilotées", {
      style: "Heading1",
      keepNext: true,
    }),
    table(
      [
        ["Constat", "Risque managérial", "Impact potentiel"],
        ...report.synthese_transverse.map((z) => [z.constat, z.risque, z.impact]),
      ],
      [3120, 3120, 3120],
      true
    ),
    pageBreak(),
    p("6. Plan d’actions — objectifs orientés résultats", {
      style: "Heading1",
      keepNext: true,
    })
  );

  report.objectifs.forEach((objective, index) => {
    out.push(objectiveCard(objective));
    if ((index + 1) % 2 === 0 && index < report.objectifs.length - 1) {
      out.push(pageBreak());
    }
  });

  out.push(
    pageBreak(),
    p("7. Conclusion dirigeant — enjeux et cohérence globale", {
      style: "Heading1",
      keepNext: true,
    }),
    p("7.1 Enjeux actuels — situation inchangée", {
      style: "Heading2",
      keepNext: true,
    }),
    ...report.conclusion.enjeux_actuels.map(bullet),
    p("7.2 Impact potentiel des actions — 12 à 24 mois", {
      style: "Heading2",
      keepNext: true,
    }),
    p(report.conclusion.impact_potentiel),
    p("7.3 Cohérence globale entre les 4 dimensions", {
      style: "Heading2",
      keepNext: true,
    }),
    p(report.conclusion.coherence_globale),
    pageBreak(),
    p("8. Confidentialité & anonymisation", { style: "Heading1", keepNext: true }),
    p(report.confidentialite),
    p("9. Checklist de conformité finale", { style: "Heading1", keepNext: true }),
    ...report.checklist.map((item) => bullet(`☑ ${item}`))
  );

  return out.join("");
}

const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:color w:val="23364D"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:before="900" w:after="260"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:color w:val="17365D"/><w:sz w:val="36"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="500"/><w:jc w:val="center"/></w:pPr><w:rPr><w:color w:val="5C6F86"/><w:sz w:val="24"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="180"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="17365D"/><w:sz w:val="30"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="220" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="315B7D"/><w:sz w:val="25"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="180" w:after="100"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:color w:val="516D86"/><w:sz w:val="22"/></w:rPr></w:style>
</w:styles>`;

export function buildReportV5Docx(report: ReportV5): Buffer {
  const zip = new PizZip();
  const now = new Date().toISOString();
  const body = documentBody(report);

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
  );
  zip.file("word/styles.xml", styles);
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`
  );
  zip.file(
    "docProps/core.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Bilan de Santé – Rapport Dirigeant</dc:title><dc:creator>Greiner Consulting</dc:creator><cp:lastModifiedBy>Greiner Consulting</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`
  );
  zip.file(
    "docProps/app.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Greiner Consulting – Bilan de Santé</Application></Properties>`
  );

  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}
