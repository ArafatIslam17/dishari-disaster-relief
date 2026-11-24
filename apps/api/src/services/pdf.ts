import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const require = createRequire(import.meta.url);
const FONT_FILES = {
  bn: 'noto-sans-bengali-bengali-400-normal.woff',
  bnBold: 'noto-sans-bengali-bengali-700-normal.woff',
  latin: 'noto-sans-bengali-latin-400-normal.woff',
  latinBold: 'noto-sans-bengali-latin-700-normal.woff',
};

let fontDir: string | null = null;
/**
 * Resolved on first use, not at import, so a missing font package can never stop the API from
 * starting. The Vercel bundle ships the fonts in a `fonts` folder beside itself
 * (tsup.vercel.config.ts); elsewhere they come from @fontsource/noto-sans-bengali.
 */
function fontPath(key: keyof typeof FONT_FILES): string {
  if (!fontDir) {
    const bundled = join(dirname(fileURLToPath(import.meta.url)), 'fonts');
    fontDir = existsSync(join(bundled, FONT_FILES.bn))
      ? bundled
      : join(dirname(require.resolve('@fontsource/noto-sans-bengali/package.json')), 'files');
  }
  return join(fontDir, FONT_FILES[key]);
}

const BENGALI = /[ঀ-৿]/;

/** Split text into Bengali and non-Bengali runs; each run uses the font subset that covers it. */
function runs(text: string): { text: string; bn: boolean }[] {
  const out: { text: string; bn: boolean }[] = [];
  for (const ch of text) {
    const bn = BENGALI.test(ch) || (ch === ' ' && out.at(-1)?.bn === true);
    const last = out.at(-1);
    if (last && last.bn === bn) last.text += ch;
    else out.push({ text: ch, bn });
  }
  return out;
}

export class ReportPdf {
  readonly doc: PDFKit.PDFDocument;

  constructor(title: string) {
    this.doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: title, Producer: 'Relief Coordination' } });
    this.doc.registerFont('bn', fontPath('bn'));
    this.doc.registerFont('bnBold', fontPath('bnBold'));
    this.doc.registerFont('latin', fontPath('latin'));
    this.doc.registerFont('latinBold', fontPath('latinBold'));
  }

  text(value: string, opts: { size?: number; bold?: boolean; color?: string; gap?: number } = {}): this {
    const parts = runs(value);
    this.doc.fontSize(opts.size ?? 10).fillColor(opts.color ?? '#14212B');
    parts.forEach((p, i) => {
      this.doc.font(p.bn ? (opts.bold ? 'bnBold' : 'bn') : opts.bold ? 'latinBold' : 'latin');
      this.doc.text(p.text, { continued: i < parts.length - 1 });
    });
    if (opts.gap) this.doc.moveDown(opts.gap);
    return this;
  }

  /** Simple table with a header row; long tables break across pages. */
  table(headers: string[], rows: (string | number)[][], widths: number[]): this {
    const x0 = this.doc.page.margins.left;
    const drawRow = (cells: (string | number)[], bold: boolean) => {
      const y = this.doc.y;
      let x = x0;
      let height = 0;
      cells.forEach((cell, i) => {
        const w = widths[i] ?? 80;
        const s = String(cell);
        this.doc.font(BENGALI.test(s) ? (bold ? 'bnBold' : 'bn') : bold ? 'latinBold' : 'latin').fontSize(9).fillColor('#14212B');
        const h = this.doc.heightOfString(s, { width: w - 6 });
        this.doc.text(s, x + 3, y + 3, { width: w - 6 });
        height = Math.max(height, h + 6);
        x += w;
      });
      this.doc.moveTo(x0, y + height).lineTo(x, y + height).strokeColor('#C9D3D8').lineWidth(0.5).stroke();
      this.doc.x = x0;
      this.doc.y = y + height;
    };
    drawRow(headers, true);
    for (const r of rows) {
      if (this.doc.y > this.doc.page.height - this.doc.page.margins.bottom - 30) {
        this.doc.addPage();
        drawRow(headers, true);
      }
      drawRow(r, false);
    }
    this.doc.moveDown(1);
    return this;
  }

  async toBuffer(): Promise<Buffer> {
    const chunks: Buffer[] = [];
    this.doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => this.doc.on('end', () => resolve(Buffer.concat(chunks))));
    this.doc.end();
    return done;
  }
}
