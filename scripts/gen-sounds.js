'use strict';
// Synthesizes the rooster crow and completion chime as 16-bit mono WAV assets.
const fs = require('fs');
const path = require('path');

const RATE = 22050;

function wavBuffer(samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

function env(t, dur, attack = 0.012, release = 0.06) {
  if (t < attack) return t / attack;
  if (t > dur - release) return Math.max(0, (dur - t) / release);
  return 1;
}

// One crow syllable: harmonic-rich tone following a frequency contour.
function syllable(dur, contour, vibrato = 0) {
  const n = Math.floor(dur * RATE);
  const out = new Float64Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const p = t / dur;
    let f = contour[0];
    for (let k = 0; k < contour.length - 1; k++) {
      const a = k / (contour.length - 1);
      const b = (k + 1) / (contour.length - 1);
      if (p >= a && p <= b) {
        const u = (p - a) / (b - a);
        f = contour[k] + (contour[k + 1] - contour[k]) * u;
      }
    }
    if (vibrato) f *= 1 + vibrato * Math.sin(2 * Math.PI * 7 * t);
    phase += (2 * Math.PI * f) / RATE;
    const e = env(t, dur);
    out[i] = e * (
      0.62 * Math.sin(phase) +
      0.30 * Math.sin(2 * phase + 0.4) +
      0.16 * Math.sin(3 * phase + 0.9) +
      0.07 * Math.sin(4 * phase)
    );
  }
  return out;
}

function concat(parts, gapSec = 0.045) {
  const gap = Math.floor(gapSec * RATE);
  const total = parts.reduce((s, p) => s + p.length + gap, 0);
  const out = new Float64Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length + gap;
  }
  return out;
}

function normalize(a, peak = 0.82) {
  let m = 0;
  for (const v of a) m = Math.max(m, Math.abs(v));
  if (!m) return a;
  const k = peak / m;
  return Array.from(a, (v) => v * k);
}

// "cock-a-doodle-doo" — four syllables, last one long with vibrato.
const crow = normalize(concat([
  syllable(0.13, [620, 880]),
  syllable(0.11, [700, 1020]),
  syllable(0.17, [880, 1250, 1080]),
  syllable(0.62, [980, 1420, 1180, 860], 0.035)
]));

// Soft two-note completion chime.
function bell(freq, dur) {
  const n = Math.floor(dur * RATE);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const e = Math.exp(-3.2 * t) * env(t, dur, 0.004, 0.05);
    out[i] = e * (Math.sin(2 * Math.PI * freq * t) + 0.45 * Math.sin(2 * Math.PI * freq * 2 * t) + 0.2 * Math.sin(2 * Math.PI * freq * 3.01 * t));
  }
  return out;
}
const ding = normalize(concat([bell(880, 0.28), bell(1318.5, 0.42)], 0.02), 0.6);

const outDir = path.join(__dirname, '..', 'miniprogram', 'assets');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'crow.wav'), wavBuffer(crow));
fs.writeFileSync(path.join(outDir, 'ding.wav'), wavBuffer(ding));
console.log('crow.wav', (crow.length / RATE).toFixed(2) + 's', fs.statSync(path.join(outDir, 'crow.wav')).size, 'bytes');
console.log('ding.wav', (ding.length / RATE).toFixed(2) + 's', fs.statSync(path.join(outDir, 'ding.wav')).size, 'bytes');