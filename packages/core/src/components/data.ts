import type { Code, Table, TableRow } from "mdast";

export type Row = Record<string, string>;
export interface Dataset {
  columns: string[];
  rows: Row[];
}

const MAX_ROWS = 1000;

/** RFC 4180-ish CSV: commas, double-quoted fields, "" escapes. */
export function parseCsv(text: string): Dataset {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (field += '"', i++);
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") (record.push(field.trim()), (field = ""));
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(field.trim());
      if (record.some((f) => f !== "")) records.push(record);
      record = [];
      field = "";
    } else field += ch;
  }
  record.push(field.trim());
  if (record.some((f) => f !== "")) records.push(record);
  const [header, ...body] = records;
  if (!header) throw new Error("the data is empty");
  if (body.length > MAX_ROWS) throw new Error(`at most ${MAX_ROWS} rows`);
  return { columns: header, rows: body.map((r) => Object.fromEntries(header.map((c, i) => [c, r[i] ?? ""]))) };
}

/** A JSON array of flat objects. */
export function parseJsonRows(text: string): Dataset {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data) || !data.every((r) => r && typeof r === "object" && !Array.isArray(r))) throw new Error("JSON data must be an array of objects");
  if (data.length > MAX_ROWS) throw new Error(`at most ${MAX_ROWS} rows`);
  const columns = [...new Set(data.flatMap((r) => Object.keys(r as object)))];
  return { columns, rows: data.map((r) => Object.fromEntries(columns.map((c) => [c, String((r as Record<string, unknown>)[c] ?? "")]))) };
}

export function readDataset(code: Code): Dataset {
  const lang = (code.lang ?? "").toLowerCase();
  if (lang === "csv") return parseCsv(code.value);
  if (lang === "json") return parseJsonRows(code.value);
  throw new Error(`data must be a csv or json code block, not "${code.lang ?? "plain"}"`);
}

export const isNumeric = (v: string) => v.trim() !== "" && Number.isFinite(Number(v.replace(/,/g, "")));

export function datasetToMdastTable(d: Dataset): Table {
  const row = (cells: string[]): TableRow => ({ type: "tableRow", children: cells.map((v) => ({ type: "tableCell", children: [{ type: "text", value: v }] })) });
  return { type: "table", align: d.columns.map(() => null), children: [row(d.columns), ...d.rows.map((r) => row(d.columns.map((c) => r[c] ?? "")))] };
}
