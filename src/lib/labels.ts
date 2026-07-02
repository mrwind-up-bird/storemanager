// src/lib/labels.ts
// Pure A4 price-label layout helpers (C12) — no jsPDF import here, so this stays in the fast
// node test env and out of any bundle that doesn't actually print. LabelPrintModal is the only
// consumer that touches jsPDF/qrcode, and only via dynamic import inside its submit handler.

import { fromCents } from '@/lib/money';

export interface LabelItem {
  artist: string;
  title: string;
  format: string | null;
  conditionRecord: number;
  priceCents: number | null;
  discogsId: number | null;
}

/** Grid geometry for a sheet of labels, in millimetres. */
export interface LabelTemplate {
  cols: number;
  rows: number;
  pageW: number;
  pageH: number;
  marginX: number;
  marginY: number;
  gutterX: number;
  gutterY: number;
}

/** Avery-style 3×8 A4 sheet — 24 labels/page. */
export const AVERY_3x8: LabelTemplate = {
  cols: 3,
  rows: 8,
  pageW: 210,
  pageH: 297,
  marginX: 7,
  marginY: 15,
  gutterX: 2.5,
  gutterY: 0,
};

export interface LabelCell {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Which page + cell (mm) an item at `index` (0-based, across all pages) lands on. */
export function labelGridLayout(index: number, template: LabelTemplate): { page: number; cell: LabelCell } {
  const { cols, rows, pageW, pageH, marginX, marginY, gutterX, gutterY } = template;
  const perPage = cols * rows;
  const page = Math.floor(index / perPage);
  const k = index % perPage;
  const col = k % cols;
  const row = Math.floor(k / cols);

  const w = (pageW - 2 * marginX - (cols - 1) * gutterX) / cols;
  const h = (pageH - 2 * marginY - (rows - 1) * gutterY) / rows;
  const x = marginX + col * (w + gutterX);
  const y = marginY + row * (h + gutterY);

  return { page, cell: { x, y, w, h } };
}

/** Discogs release page for a given release id. */
export function discogsReleaseUrl(discogsId: number): string {
  return `https://www.discogs.com/release/${discogsId}`;
}

/** Big price line for a label — '€ 12,00' (comma decimal), '—' when no price is set. */
export function labelPriceText(priceCents: number | null): string {
  if (priceCents === null) return '—';
  return `€ ${fromCents(priceCents).replace('.', ',')}`;
}
