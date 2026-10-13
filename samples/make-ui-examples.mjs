// Writes six made-up UI example pictures in samples/files/ui-examples/ (R7.13), for the Gallery
// sample. They are plain wireframes drawn with code: no real product, brand, logo or person. Each
// carries a SAMPLE mark. No dependencies: a tiny pixel canvas and a PNG writer on node:zlib.
//
//   node samples/make-ui-examples.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'files', 'ui-examples');

// ------------------------------------------------------------------ PNG

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function png(canvas, comment) {
  const { width, height, px } = canvas;
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // no filter
    Buffer.from(px.buffer, y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk(
      'tEXt',
      Buffer.from(`Comment\0SAMPLE ${comment} (made up for the Pharos Gallery sample)`, 'latin1'),
    ),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ a tiny canvas

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const C = {
  page: hex('#f5f5f4'),
  white: hex('#ffffff'),
  line: hex('#e5e5e5'),
  ink: hex('#262626'),
  muted: hex('#737373'),
  faint: hex('#d4d4d4'),
  accent: hex('#0284c7'),
  accentSoft: hex('#e0f2fe'),
  good: hex('#16a34a'),
  goodSoft: hex('#dcfce7'),
  warn: hex('#d97706'),
  photo: hex('#cbd5e1'),
  photo2: hex('#94a3b8'),
  dark: hex('#1f2937'),
};

function canvas(width, height, bg = C.page) {
  const px = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) px.set(bg, i * 3);
  const set = (x, y, color) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    px.set(color, (y * width + x) * 3);
  };
  const rect = (x, y, w, h, color, r = 0) => {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) {
        // Rounded corners: skip pixels outside the corner circles.
        const dx = xx < x + r ? x + r - xx : xx >= x + w - r ? xx - (x + w - r - 1) : 0;
        const dy = yy < y + r ? y + r - yy : yy >= y + h - r ? yy - (y + h - r - 1) : 0;
        if (dx && dy && dx * dx + dy * dy > r * r) continue;
        set(xx, yy, color);
      }
  };
  const frame = (x, y, w, h, color, r = 0, fill) => {
    rect(x, y, w, h, color, r);
    rect(x + 1, y + 1, w - 2, h - 2, fill ?? C.white, Math.max(0, r - 1));
  };
  const circle = (cx, cy, radius, color) => {
    for (let y = cy - radius; y <= cy + radius; y++)
      for (let x = cx - radius; x <= cx + radius; x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) set(x, y, color);
  };
  const text = (x, y, words, color = C.ink, scale = 2) => {
    let at = x;
    for (const ch of words.toUpperCase()) {
      const glyph = GLYPHS[ch] ?? GLYPHS['?'];
      glyph.forEach((row, gy) =>
        [...row].forEach((bit, gx) => {
          if (bit === '1') rect(at + gx * scale, y + gy * scale, scale, scale, color);
        }),
      );
      at += 6 * scale;
    }
    return at - x;
  };
  /** A grey "picture" with a sun and a hill, standing in for a photo. */
  const photo = (x, y, w, h) => {
    rect(x, y, w, h, C.photo);
    circle(
      x + Math.round(w * 0.72),
      y + Math.round(h * 0.3),
      Math.round(Math.min(w, h) * 0.1),
      C.white,
    );
    for (let xx = 0; xx < w; xx++) {
      const top = Math.round(h * 0.62 - Math.sin((xx / w) * Math.PI) * h * 0.22);
      rect(x + xx, y + top, 1, h - top, C.photo2);
    }
  };
  return { width, height, px, set, rect, frame, circle, text, photo };
}

// 5x7 capitals, digits and a few marks.
const GLYPHS = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10011', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ',': ['00000', '00000', '00000', '00000', '01100', '00100', '01000'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
  $: ['00100', '01111', '10100', '01110', '00101', '11110', '00100'],
  '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
  '>': ['01000', '00100', '00010', '00001', '00010', '00100', '01000'],
  '<': ['00010', '00100', '01000', '10000', '01000', '00100', '00010'],
};

const W = 640;
const H = 420;

/** The page every example sits on: a title bar and a SAMPLE mark in the corner. */
function screen(title) {
  const c = canvas(W, H);
  c.rect(0, 0, W, 44, C.white);
  c.rect(0, 44, W, 1, C.line);
  c.circle(22, 22, 6, C.faint);
  c.text(40, 15, title, C.ink, 2);
  const mark = 'SAMPLE';
  c.rect(W - 92, 12, 80, 20, C.accentSoft, 4);
  c.text(W - 88, 16, mark, C.accent, 2);
  return c;
}

// ------------------------------------------------------------------ the six examples

function cardLayout() {
  const c = screen('Card layout');
  const cards = [
    ['Lake trail', '4.2 km . easy'],
    ['Old town', '2.8 km . easy'],
    ['Ridge walk', '9.1 km . hard'],
  ];
  cards.forEach(([name, meta], i) => {
    const x = 32 + i * 196;
    c.frame(x, 76, 180, 300, C.line, 10);
    c.photo(x + 1, 77, 178, 150);
    c.text(x + 14, 244, name, C.ink, 2);
    c.text(x + 14, 270, meta, C.muted, 2);
    c.rect(x + 14, 330, 70, 28, C.accent, 6);
    c.text(x + 24, 337, 'Open', C.white, 2);
  });
  return c;
}

function stepper() {
  const c = screen('Stepper');
  const steps = ['Cart', 'Address', 'Payment', 'Done'];
  const y = 130;
  c.rect(90, y - 2, 460, 4, C.faint);
  c.rect(90, y - 2, 230, 4, C.accent);
  steps.forEach((label, i) => {
    const x = 90 + i * 153;
    const done = i < 2;
    const now = i === 2;
    c.circle(x, y, 20, done ? C.accent : now ? C.accent : C.faint);
    if (!done) c.circle(x, y, now ? 16 : 18, C.white);
    c.text(x - 5, y - 7, String(i + 1), done ? C.white : now ? C.accent : C.muted, 2);
    c.text(x - label.length * 6, y + 36, label, now ? C.ink : C.muted, 2);
  });
  c.frame(90, 230, 460, 120, C.line, 10);
  c.text(114, 252, 'Payment', C.ink, 2);
  c.frame(114, 284, 300, 36, C.line, 6);
  c.text(126, 296, 'Card number', C.faint, 2);
  c.rect(430, 284, 96, 36, C.accent, 6);
  c.text(446, 296, 'Next', C.white, 2);
  return c;
}

/** Option A: an empty list that only says so. */
function emptyStateBefore() {
  const c = screen('Empty state . A');
  c.frame(60, 80, 520, 300, C.line, 10);
  c.text(84, 100, 'Projects', C.ink, 2);
  c.rect(61, 128, 518, 1, C.line);
  c.text(250, 238, 'No items', C.faint, 2);
  return c;
}

/** Option B: the same empty list that shows what to do next. */
function emptyStateAfter() {
  const c = screen('Empty state . B');
  c.frame(60, 80, 520, 300, C.line, 10);
  c.text(84, 100, 'Projects', C.ink, 2);
  c.rect(61, 128, 518, 1, C.line);
  c.circle(320, 190, 34, C.accentSoft);
  c.rect(304, 176, 32, 28, C.accent, 4);
  c.rect(308, 170, 14, 8, C.accent, 2);
  c.text(212, 240, 'No projects yet', C.ink, 2);
  c.text(140, 266, 'Start one to plan your work.', C.muted, 2);
  c.rect(232, 302, 176, 36, C.accent, 6);
  c.text(242, 314, '+ New project', C.white, 2);
  return c;
}

function tabs() {
  const c = screen('Tabs');
  const names = ['Overview', 'Tasks', 'Files', 'History'];
  let x = 40;
  names.forEach((name, i) => {
    const w = name.length * 12 + 24;
    if (i === 1) c.rect(x, 104, w, 3, C.accent);
    c.text(x + 12, 80, name, i === 1 ? C.ink : C.muted, 2);
    x += w + 8;
  });
  c.rect(32, 107, 576, 1, C.line);
  ['Write the brief', 'Review the draft', 'Send to the team'].forEach((task, i) => {
    const y = 132 + i * 72;
    c.frame(40, y, 560, 56, C.line, 8);
    c.frame(58, y + 18, 20, 20, i === 0 ? C.good : C.faint, 4, i === 0 ? C.goodSoft : C.white);
    c.text(96, y + 22, task, i === 0 ? C.muted : C.ink, 2);
  });
  return c;
}

function toast() {
  const c = screen('Toast');
  // A faded page behind.
  for (let i = 0; i < 4; i++) c.rect(40, 80 + i * 50, 380 - i * 60, 18, C.line, 4);
  c.photo(440, 80, 160, 120);
  c.frame(100, 300, 440, 70, C.dark, 12, C.dark);
  c.circle(136, 335, 12, C.good);
  c.text(131, 328, '+', C.white, 2);
  c.text(162, 318, 'Saved', C.white, 2);
  c.text(162, 342, 'Your changes are kept.', C.faint, 2);
  c.text(474, 330, 'Undo', hex('#7dd3fc'), 2);
  return c;
}

const EXAMPLES = {
  'card-layout.png': [cardLayout, 'card layout'],
  'stepper.png': [stepper, 'stepper'],
  'empty-state-a.png': [emptyStateBefore, 'empty state, option A'],
  'empty-state-b.png': [emptyStateAfter, 'empty state, option B'],
  'tabs.png': [tabs, 'tabs'],
  'toast.png': [toast, 'toast'],
};

mkdirSync(out, { recursive: true });
for (const [name, [draw, comment]] of Object.entries(EXAMPLES)) {
  writeFileSync(join(out, name), png(draw(), comment));
  console.log(`wrote ${join('samples', 'files', 'ui-examples', name)}`);
}
