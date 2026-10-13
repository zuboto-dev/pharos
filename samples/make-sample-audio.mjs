// Writes the made-up sample mixes in samples/files/music/ (R9 Music pack): a few seconds of
// generated tones per file, as 16-bit mono WAV. No recording, no dependencies; every "song" is
// invented and each mix differs only in its chord, tempo and a fade, so they sound apart.
//
//   node samples/make-sample-audio.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'files', 'music');
const RATE = 11025;

/** A note name to its frequency, e.g. "A4" → 440. */
function hz(note) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const [, name, octave] = note.match(/^([A-G]#?)(\d)$/);
  const semitones = names.indexOf(name) - 9 + (Number(octave) - 4) * 12;
  return 440 * 2 ** (semitones / 12);
}

/**
 * Chords played one after another, `beat` seconds each, with a soft attack and release so
 * nothing clicks. Returns 16-bit samples.
 */
function render(chords, beat, gain = 0.25) {
  const perChord = Math.round(beat * RATE);
  const samples = new Int16Array(perChord * chords.length);
  chords.forEach((chord, c) => {
    const freqs = chord.map(hz);
    for (let i = 0; i < perChord; i++) {
      const t = i / RATE;
      const envelope = Math.min(1, i / (0.02 * RATE)) * Math.min(1, (perChord - i) / (0.15 * RATE));
      let v = 0;
      for (const f of freqs)
        v += Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t);
      samples[c * perChord + i] = Math.round((v / freqs.length) * envelope * gain * 32767);
    }
  });
  return samples;
}

function wav(samples) {
  const data = Buffer.from(samples.buffer);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM header size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28); // bytes per second
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const Am = ['A3', 'C4', 'E4'];
const F = ['F3', 'A3', 'C4'];
const C = ['C4', 'E4', 'G4'];
const G = ['G3', 'B3', 'D4'];
const D = ['D4', 'F#4', 'A4'];
const Bm = ['B3', 'D4', 'F#4'];
const Dm = ['D4', 'F4', 'A4'];

const MIXES = {
  'night-bus-mix-1.wav': render([Am, F, C, G], 0.65, 0.18),
  'night-bus-mix-2.wav': render([Am, F, C, G], 0.65, 0.24),
  'night-bus-mix-3.wav': render([Am, F, C, G, Am], 0.6, 0.28),
  'paper-boats-rough.wav': render([D, Bm, G, D], 0.5),
  'low-tide-demo.wav': render([F, Dm, C], 0.9, 0.2),
};

mkdirSync(out, { recursive: true });
for (const [name, samples] of Object.entries(MIXES)) {
  writeFileSync(join(out, name), wav(samples));
  console.log(`${name}: ${(samples.length / RATE).toFixed(1)} s`);
}
