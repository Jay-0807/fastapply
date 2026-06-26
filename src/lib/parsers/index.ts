// Document text extraction.
// Lazy-loads parser libs to keep the popup bundle small.

/** Image extensions — routed to project ASSETS (not text-extracted). */
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
/** Text-bearing extensions we can extract a string from. */
export const TEXT_EXTENSIONS = ['.pdf', '.docx', '.md', '.markdown', '.txt', '.pptx', '.xlsx', '.csv'];

export type FileKind = 'text' | 'image' | 'unsupported';

/**
 * Coarse routing for the bulk importer: text files get parsed + fed to the AI
 * classifier; images become asset candidates; anything else is skipped.
 */
export function classifyFileKind(filename: string): FileKind {
  const n = filename.toLowerCase();
  if (IMAGE_EXTENSIONS.some((e) => n.endsWith(e))) return 'image';
  if (TEXT_EXTENSIONS.some((e) => n.endsWith(e))) return 'text';
  return 'unsupported';
}

export async function parseDocument(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return parsePdf(file);
  if (name.endsWith('.docx')) return parseDocx(file);
  if (name.endsWith('.pptx')) return parsePptx(file);
  if (name.endsWith('.xlsx')) return parseXlsx(file);
  if (name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.txt') || name.endsWith('.csv')) {
    return file.text();
  }
  throw new Error(`Unsupported file format: ${name}. Supported: pdf, docx, pptx, xlsx, csv, md, txt.`);
}

/** Decode the 5 predefined XML entities that appear in OOXML text runs. */
export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&'); // amp LAST so we don't double-decode
}

/** Pull the inner text of every `<tag>…</tag>` occurrence, entity-decoded. Pure (testable). */
export function collectTagText(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const t = decodeXmlEntities(m[1] ?? '').trim();
    if (t) out.push(t);
  }
  return out;
}

// pptx / xlsx are both ZIP-of-XML (OOXML). We extract a best-effort TEXT dump
// (not a faithful render) — enough for the AI classifier to read. Numbers in
// xlsx live outside sharedStrings and are intentionally skipped; the high-signal
// labels/prose are in sharedStrings.
async function parsePptx(file: File): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slidePaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => slideNum(a) - slideNum(b));
  const slides: string[] = [];
  for (const p of slidePaths) {
    const xml = await zip.files[p]!.async('string');
    const text = collectTagText(xml, 'a:t').join(' ');
    if (text.trim()) slides.push(text.trim());
  }
  return slides.join('\n\n').trim();
}

function slideNum(path: string): number {
  return Number(path.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
}

async function parseXlsx(file: File): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const shared = zip.files['xl/sharedStrings.xml'];
  if (!shared) return '';
  const xml = await shared.async('string');
  return collectTagText(xml, 't').join('\n').trim();
}

async function parsePdf(file: File): Promise<string> {
  // Lazy import to avoid pulling pdf.js into the popup bundle.
  const pdfjs = await import('pdfjs-dist');
  // The worker URL is resolved by WXT at build time.
  pdfjs.GlobalWorkerOptions.workerSrc = await import('pdfjs-dist/build/pdf.worker.min.mjs?url').then((m) => m.default);

  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const pieces: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((it) => ('str' in it ? it.str : ''))
      .join(' ');
    pieces.push(text);
  }
  return pieces.join('\n\n').replace(/\s+\n/g, '\n').trim();
}

async function parseDocx(file: File): Promise<string> {
  const mammoth = await import('mammoth');
  const buf = await file.arrayBuffer();
  const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
  return value.trim();
}
