import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = process.argv[2];
if (!outputDir) throw new Error("Output directory is required");

function buildRows(isTarget) {
  const rows = [["MATNR", "WERKS", "MAKTX", "STATUS"]];
  for (let i = 1; i <= 7500; i += 1) {
    rows.push([
      String(20000000 + i),
      i % 2 === 0 ? "CNG1" : "USG1",
      `Material ${i}`,
      isTarget && i <= 7000 ? "BLOCKED" : "ACTIVE",
    ]);
  }
  return rows;
}

async function createWorkbook(filename, isTarget) {
  const workbook = Workbook.create();
  const sheet = workbook.worksheets.add(isTarget ? "Target Data" : "Source Data");
  sheet.showGridLines = false;
  const rows = buildRows(isTarget);
  sheet.getRange(`A1:D${rows.length}`).values = rows;

  const header = sheet.getRange("A1:D1");
  header.format.fill = "#17365D";
  header.format.font = { bold: true, color: "#FFFFFF" };
  header.format.rowHeight = 24;
  header.format.borders = { preset: "all", style: "thin", color: "#A6B7C8" };

  const body = sheet.getRange(`A2:D${rows.length}`);
  body.format.borders = { preset: "all", style: "thin", color: "#D9E2F3" };
  sheet.getRange(`A2:A${rows.length}`).setNumberFormat("@");
  if (isTarget) {
    const failures = sheet.getRange("D2:D7001");
    failures.format.fill = "#FCE8E6";
    failures.format.font = { color: "#C5221F" };
    const matches = sheet.getRange("D7002:D7501");
    matches.format.fill = "#E6F4EA";
    matches.format.font = { color: "#137333" };
  }
  sheet.freezePanes.freezeRows(1);
  sheet.getRange("A:A").format.columnWidth = 16;
  sheet.getRange("B:B").format.columnWidth = 12;
  sheet.getRange("C:C").format.columnWidth = 24;
  sheet.getRange("D:D").format.columnWidth = 14;
  const table = sheet.tables.add(`A1:D${rows.length}`, true, isTarget ? "TargetExample" : "SourceExample");
  table.style = "TableStyleMedium2";

  await fs.mkdir(outputDir, { recursive: true });
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(`${outputDir}/${filename}`);
  const preview = await workbook.render({ sheetName: sheet.name, range: "A1:D18", scale: 1.2, format: "png" });
  await fs.writeFile(`${outputDir}/${filename.replace(".xlsx", "-preview.png")}`, new Uint8Array(await preview.arrayBuffer()));

  const inspection = await workbook.inspect({ kind: "region", sheetId: sheet.name, range: "A1:D6", maxChars: 2500 });
  console.log(filename, inspection.ndjson ?? inspection);
}

await createWorkbook("SAP_Source_7500_Rows.xlsx", false);
await createWorkbook("SAP_Target_7000_Errors.xlsx", true);
