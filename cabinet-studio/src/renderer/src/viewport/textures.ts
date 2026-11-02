// Procedural PBR textures (wood grain, stone veining, brushed metal) generated on a
// canvas at load time, so the app ships without large image assets and every board
// gets a believable, tileable surface. Imported photos use the same material path.

import type { MaterialAppearance } from '@engine/index';

function rng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

/** Tileable value noise on a px×py lattice; sample spans that are multiples of the period tile seamlessly. */
function makeNoise(seed: number, px: number, py = px): (x: number, y: number) => number {
  const r = rng(seed);
  const grid = new Float32Array(px * py).map(() => r());
  const at = (i: number, j: number) => grid[(((j % py) + py) % py) * px + (((i % px) + px) % px)];
  const fade = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const tx = fade(x - xi);
    const ty = fade(y - yi);
    const a = at(xi, yi);
    const b = at(xi + 1, yi);
    const c = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

function fbm(noise: (x: number, y: number) => number, x: number, y: number, octaves: number): number {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    v += amp * noise(x * f, y * f);
    f *= 2;
    amp *= 0.5;
  }
  return v;
}

const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export interface TextureCanvases {
  color: HTMLCanvasElement;
  roughness?: HTMLCanvasElement;
}

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D, ImageData] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  return [c, ctx, ctx.createImageData(size, size)];
}

/** Wood: grain runs along the texture V axis (canvas vertical). */
function wood(a: MaterialAppearance, size: number): TextureCanvases {
  const [c, ctx, img] = canvas(size);
  const [rc, rctx, rimg] = canvas(size);
  const seed = a.seed ?? 7;
  const n1 = makeNoise(seed, 8, 2);
  const n2 = makeNoise(seed + 1, 64, 4);
  const n3 = makeNoise(seed + 2, 16, 4);
  const base = hex(a.color);
  const dark = hex(a.color2 ?? a.color);
  const rings = 22;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      // Distorted ring field: lines mostly parallel to V with slow wobble.
      const warp = fbm(n1, u * 8, v * 2, 3) * 2.2 + fbm(n3, u * 16, v * 4, 2) * 0.5;
      const ring = (u * rings + warp) % 1;
      const late = Math.pow(Math.abs(Math.sin(ring * Math.PI)), 6);
      const fine = n2(u * 64, v * 4) * 0.35;
      const pores = n2(u * 64 + 13, v * 64) > 0.82 ? 0.25 : 0;
      const t = Math.min(1, late * 0.75 + fine * 0.6 + pores);
      const col = mix(base, dark, t);
      const i = (y * size + x) * 4;
      img.data[i] = col[0];
      img.data[i + 1] = col[1];
      img.data[i + 2] = col[2];
      img.data[i + 3] = 255;
      const r = Math.min(255, Math.max(0, (a.roughness + t * 0.15 - 0.05) * 255));
      rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = r;
      rimg.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  return { color: c, roughness: rc };
}

/** Stone: soft cloudy base with sharp, branching veins. */
function stone(a: MaterialAppearance, size: number): TextureCanvases {
  const [c, ctx, img] = canvas(size);
  const seed = a.seed ?? 3;
  const n1 = makeNoise(seed, 6);
  const n2 = makeNoise(seed + 5, 24);
  const n3 = makeNoise(seed + 9, 96);
  const base = hex(a.color);
  const vein = hex(a.color2 ?? '#888888');
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const cloud = fbm(n2, u * 24, v * 24, 4);
      const flow = fbm(n1, u * 6, v * 6, 4) * 6 + u * 3 + v;
      const vline = Math.abs(Math.sin(flow * Math.PI));
      const veinT = Math.pow(1 - vline, 18) * 0.9 + Math.pow(1 - vline, 4) * 0.12;
      const speck = n3(u * 96, v * 96) > 0.88 ? 0.08 : 0;
      const t = Math.min(1, veinT + (cloud - 0.5) * 0.12 + speck);
      const col = mix(base, vein, Math.max(0, t));
      const i = (y * size + x) * 4;
      img.data[i] = col[0];
      img.data[i + 1] = col[1];
      img.data[i + 2] = col[2];
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { color: c };
}

/** Brushed metal: fine streaks along U, drives colour and roughness. */
function metal(a: MaterialAppearance, size: number): TextureCanvases {
  const [c, ctx, img] = canvas(size);
  const [rc, rctx, rimg] = canvas(size);
  const n = makeNoise(a.seed ?? 2, 2, 128);
  const m = makeNoise((a.seed ?? 2) + 1, 8, 128);
  const base = hex(a.color);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = n((x / size) * 2, (y / size) * 128) * 0.6 + m((x / size) * 8, (y / size) * 128) * 0.4;
      const k = 0.88 + s * 0.2;
      const i = (y * size + x) * 4;
      img.data[i] = Math.min(255, base[0] * k);
      img.data[i + 1] = Math.min(255, base[1] * k);
      img.data[i + 2] = Math.min(255, base[2] * k);
      img.data[i + 3] = 255;
      rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = Math.min(255, (a.roughness + (s - 0.5) * 0.2) * 255);
      rimg.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  return { color: c, roughness: rc };
}

export function proceduralTexture(a: MaterialAppearance, maxSize: number): TextureCanvases | null {
  switch (a.kind) {
    case 'wood':
      return wood(a, Math.min(maxSize, 1024));
    case 'stone':
      return stone(a, Math.min(maxSize, 1024));
    case 'metal':
      return metal(a, Math.min(maxSize, 256));
    default:
      return null;
  }
}
