// Document text extraction.
// Lazy-loads parser libs to keep the popup bundle small.

export async function parseDocument(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return parsePdf(file);
  if (name.endsWith('.docx')) return parseDocx(file);
  if (name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.txt')) {
    return file.text();
  }
  throw new Error(`Unsupported file format: ${name}. Supported: pdf, docx, md, txt.`);
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
