import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import PptxGenJS from "pptxgenjs";
import { inflateRawSync } from "node:zlib";

export type WordBlock =
  | { type?: "paragraph"; text: string }
  | { type: "heading"; text: string; level?: 1 | 2 | 3 }
  | { type: "bullet"; text: string };

/** Expand freeform text (including markdown-ish lines) into structured Word blocks. */
export function expandTextToWordBlocks(text: string): WordBlock[] {
  const blocks: WordBlock[] = [];
  for (const rawLine of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const headingMd = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMd) {
      const level = headingMd[1].length as 1 | 2 | 3;
      blocks.push({ type: "heading", text: headingMd[2].trim(), level });
      continue;
    }
    const numbered = line.match(/^(\d+)\.\s+(.+)$/);
    if (numbered && numbered[2].length < 120) {
      blocks.push({ type: "heading", text: `${numbered[1]}. ${numbered[2]}`, level: 1 });
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      blocks.push({ type: "bullet", text: bullet[1].trim() });
      continue;
    }
    blocks.push({ type: "paragraph", text: line });
  }
  return blocks;
}

export type ExcelSheetInput = {
  name?: string;
  rows: Array<Array<string | number | boolean | null | undefined>>;
};

export type PowerPointSlideInput = {
  title: string;
  bullets?: string[];
  notes?: string;
};

function ensureExtension(path: string, ext: string) {
  const normalized = path.trim().replace(/^\/+/, "");
  if (!normalized) throw new Error("OneDrive path is required.");
  return normalized.toLowerCase().endsWith(ext) ? normalized : `${normalized}${ext}`;
}

/** Default to OneDrive My files root (not a nested Documents/ folder). */
export function defaultOfficePath(filename: string, folder = "") {
  const safe = filename.replace(/[\\/]+/g, "-").trim() || "untitled";
  const dir = folder.replace(/^\/+|\/+$/g, "");
  return dir ? `${dir}/${safe}` : safe;
}

export async function buildWordDocument(input: {
  title?: string;
  blocks?: WordBlock[];
  paragraphs?: string[];
}): Promise<Buffer> {
  const children: Paragraph[] = [];
  if (input.title?.trim()) {
    children.push(
      new Paragraph({
        text: input.title.trim(),
        heading: HeadingLevel.TITLE,
        spacing: { after: 200 },
      }),
    );
  }

  let blocks: WordBlock[] = [];
  if (input.blocks?.length) {
    for (const block of input.blocks) {
      const text = (block.text || "").trim();
      if (!text) continue;
      if ((block.type === "paragraph" || !block.type) && text.includes("\n")) {
        blocks.push(...expandTextToWordBlocks(text));
      } else {
        blocks.push(block);
      }
    }
  } else {
    for (const paragraph of input.paragraphs || []) {
      blocks.push(...expandTextToWordBlocks(paragraph));
    }
  }

  for (const block of blocks) {
    const text = (block.text || "").trim();
    if (!text) continue;
    if (block.type === "heading") {
      const level =
        block.level === 2
          ? HeadingLevel.HEADING_2
          : block.level === 3
            ? HeadingLevel.HEADING_3
            : HeadingLevel.HEADING_1;
      children.push(new Paragraph({ text, heading: level, spacing: { before: 200, after: 120 } }));
    } else if (block.type === "bullet") {
      children.push(
        new Paragraph({
          text,
          bullet: { level: 0 },
          spacing: { after: 80 },
        }),
      );
    } else {
      children.push(
        new Paragraph({
          children: [new TextRun(text)],
          spacing: { after: 120 },
        }),
      );
    }
  }

  if (!children.length) {
    children.push(new Paragraph({ children: [new TextRun("")] }));
  }

  const doc = new Document({
    sections: [{ children }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

export async function buildExcelWorkbook(sheets: ExcelSheetInput[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const list = sheets.length ? sheets : [{ name: "Sheet1", rows: [] }];
  for (const [index, sheet] of list.entries()) {
    const ws = workbook.addWorksheet(
      (sheet.name || `Sheet${index + 1}`).slice(0, 31) || `Sheet${index + 1}`,
    );
    for (const row of sheet.rows || []) {
      ws.addRow((row || []).map((cell) => (cell === undefined ? null : cell)));
    }
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function buildPowerPointPresentation(input: {
  title?: string;
  slides: PowerPointSlideInput[];
}): Promise<Buffer> {
  const pptx = new PptxGenJS();
  if (input.title?.trim()) pptx.title = input.title.trim();

  const slides = input.slides?.length
    ? input.slides
    : [{ title: input.title?.trim() || "Presentation", bullets: [] }];

  for (const slide of slides) {
    const s = pptx.addSlide();
    s.addText(slide.title || "Slide", {
      x: 0.5,
      y: 0.4,
      w: 9,
      h: 0.8,
      fontSize: 28,
      bold: true,
    });
    const bullets = (slide.bullets || []).filter((b) => b?.trim());
    if (bullets.length) {
      s.addText(
        bullets.map((text) => ({ text, options: { bullet: true, breakLine: true } })),
        { x: 0.7, y: 1.4, w: 8.5, h: 4.5, fontSize: 18 },
      );
    }
    if (slide.notes?.trim()) s.addNotes(slide.notes.trim());
  }

  const output = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  return Buffer.from(output);
}

export async function extractWordText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return (result.value || "").trim();
}

export async function extractExcelSheets(
  buffer: Buffer,
  options: { maxRowsPerSheet?: number; maxSheets?: number } = {},
): Promise<Array<{ name: string; rows: Array<Array<string | number | boolean | null>> }>> {
  const maxRows = Math.min(Math.max(options.maxRowsPerSheet ?? 100, 1), 500);
  const maxSheets = Math.min(Math.max(options.maxSheets ?? 10, 1), 25);
  const workbook = new ExcelJS.Workbook();
  // exceljs typings expect a specialized Buffer; Node Buffer is fine at runtime.
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheets: Array<{
    name: string;
    rows: Array<Array<string | number | boolean | null>>;
  }> = [];

  for (const ws of workbook.worksheets.slice(0, maxSheets)) {
    const rows: Array<Array<string | number | boolean | null>> = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber > maxRows) return;
      const values = row.values;
      const arr = Array.isArray(values) ? values.slice(1) : [];
      rows.push(
        arr.map((cell) => {
          if (cell == null) return null;
          if (typeof cell === "object" && cell && "text" in cell) {
            return String((cell as { text?: string }).text ?? "");
          }
          if (typeof cell === "object" && cell && "result" in cell) {
            const result = (cell as { result?: unknown }).result;
            if (typeof result === "string" || typeof result === "number" || typeof result === "boolean") {
              return result;
            }
            return result == null ? null : String(result);
          }
          if (
            typeof cell === "string" ||
            typeof cell === "number" ||
            typeof cell === "boolean"
          ) {
            return cell;
          }
          return String(cell);
        }),
      );
    });
    sheets.push({ name: ws.name, rows });
  }
  return sheets;
}

/** Best-effort PPTX text extraction via local zip/XML parse (no extra dependency). */
export function extractPowerPointText(buffer: Buffer): Array<{
  slide: number;
  text: string[];
}> {
  const files = unzipPptx(buffer);
  const slideNames = Object.keys(files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)/i)?.[1] || 0);
      const nb = Number(b.match(/slide(\d+)/i)?.[1] || 0);
      return na - nb;
    });

  return slideNames.map((name, index) => {
    const xml = files[name] || "";
    const texts = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((m) =>
      decodeXml(m[1] || "").trim(),
    );
    return {
      slide: index + 1,
      text: texts.filter(Boolean),
    };
  });
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function unzipPptx(buffer: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    const sig = buffer.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const compression = buffer.readUInt16LE(offset + 8);
    const compSize = buffer.readUInt32LE(offset + 18);
    const uncompSize = buffer.readUInt32LE(offset + 22);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buffer.subarray(nameStart, nameStart + nameLen).toString("utf8");
    const dataStart = nameStart + nameLen + extraLen;
    const compressed = buffer.subarray(dataStart, dataStart + compSize);
    offset = dataStart + compSize;
    if (!name || name.endsWith("/")) continue;
    try {
      let raw: Buffer;
      if (compression === 0) raw = Buffer.from(compressed);
      else if (compression === 8) raw = inflateRawSync(compressed);
      else continue;
      if (uncompSize && raw.length > uncompSize) raw = raw.subarray(0, uncompSize);
      if (name.endsWith(".xml")) out[name] = raw.toString("utf8");
    } catch {
      /* skip bad entry */
    }
  }
  return out;
}

export function resolveOfficeUploadPath(
  path: string | undefined,
  filename: string,
  ext: ".docx" | ".xlsx" | ".pptx",
) {
  if (path?.trim()) return ensureExtension(path, ext);
  return ensureExtension(defaultOfficePath(filename), ext);
}
