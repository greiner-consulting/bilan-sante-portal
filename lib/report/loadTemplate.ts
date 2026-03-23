import fs from "fs";
import path from "path";

export async function loadActiveTemplateBuffer(): Promise<Buffer> {

  const templatePath = path.join(
    process.cwd(),
    "templates",
    "diagnostic-template.docx"
  );

  if (!fs.existsSync(templatePath)) {
    throw new Error("DOCX template not found");
  }

  return fs.readFileSync(templatePath);
}