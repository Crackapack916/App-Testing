// Generates the app's original sound effects (no third party audio). Run: node scripts/make-sounds.mjs
import { writeFileSync } from "node:fs";

const RATE = 22050;
function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.max(-1, Math.min(1, s)) * 32767, i * 2));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;

// Foil wrapper tear: bright filtered noise with irregular crackle bursts, rising then cut.
function tear(seconds = 0.55) {
  const n = Math.floor(RATE * seconds), out = new Array(n);
  let lp = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const env = Math.min(1, t * 12) * Math.pow(1 - t, 1.6);
    const crackle = rand() > 0.965 ? 2.2 : 1;
    const x = rand() * crackle;
    lp += 0.35 * (x - lp);                 // low pass for body
    const hp = x - prev; prev = x;          // high pass for the crinkle
    out[i] = (0.55 * lp + 0.45 * hp) * env * 0.9;
  }
  return out;
}

// High value hit: a bright rising arpeggio with a shimmer tail.
function hit(seconds = 1.4) {
  const n = Math.floor(RATE * seconds), out = new Array(n).fill(0);
  const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
  notes.forEach((f, k) => {
    const start = Math.floor(k * 0.07 * RATE);
    for (let i = start; i < n; i++) {
      const t = (i - start) / RATE;
      const env = Math.exp(-t * 3.2) * Math.min(1, t * 60);
      out[i] += (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 2.01 * t)) * env * 0.16;
    }
  });
  for (let i = 0; i < n; i++) out[i] += rand() * 0.02 * Math.exp(-(i / RATE) * 2); // sparkle
  return out;
}

writeFileSync("assets/sounds/pack-tear.wav", wav(tear()));
writeFileSync("assets/sounds/big-hit.wav", wav(hit()));
console.log("ok");
