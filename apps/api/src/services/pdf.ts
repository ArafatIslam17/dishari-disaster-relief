import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import PDFDocument from 'pdfkit';

const require = createRequire(import.meta.url);
const fontDir = join(dirname(require.resolve('@fontsource/noto-sans-bengali/package.json')), 'files');
const FONTS = {
  bn: join(fontDir, 'noto-sans-bengali-bengali-400-normal.woff'),
  bnBold: join(fontDir, 'noto-sans-bengali-bengali-700-normal.woff'),
  latin: join(fontDir, 'noto-sans-bengali-latin-400-normal.woff'),
  latinBold: join(fontDir, 'noto-sans-bengali-latin-700-normal.woff'),
};

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
    this.doc.registerFont('bn', FONTS.bn);
    this.doc.registerFont('bnBold', FONTS.bnBold);
    this.doc.registerFont('latin', FONTS.latin);
    this.doc.registerFont('latinBold', FONTS.latinBold);
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
