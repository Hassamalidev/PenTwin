import { createRng, type Seed } from '@pentwin/shared';

/** Raw pixels, 4 bytes per pixel (RGBA), as a canvas or a rasterizer provides them. */
export interface RasterImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

export interface EffectOptions {
  /**
   * `scan`: a flatbed scan. Nearly square, even light, a little paper tone and grain.
   * `photo`: a phone photo. Slightly turned, light falling off to one side, darker
   * corners, warmer and noisier.
   */
  mode: 'scan' | 'photo';
  seed?: Seed;
  /** 0 to 1. 0 returns the page unchanged. Defaults to 1, which is already gentle. */
  strength?: number;
  /** Adds a soft fold line across the page. */
  crease?: boolean;
}

const clamp = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Turns the page a little, as paper never lies perfectly square. Edges fill with paper white. */
function rotate(image: RasterImage, degrees: number): Uint8ClampedArray {
  const { width, height, data } = image;
  const out = new Uint8ClampedArray(data.length);
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  for (let y = 0; y < height; y++) {
    const dy = y - cy;
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const sx = cos * dx - sin * dy + cx;
      const sy = sin * dx + cos * dy + cy;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const o = (y * width + x) * 4;
      if (x0 < 0 || y0 < 0 || x0 >= width - 1 || y0 >= height - 1) {
        out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 255;
        continue;
      }
      const fx = sx - x0;
      const fy = sy - y0;
      const i = (y0 * width + x0) * 4;
      for (let c = 0; c < 4; c++) {
        const top = data[i + c]! * (1 - fx) + data[i + 4 + c]! * fx;
        const bottom = data[i + width * 4 + c]! * (1 - fx) + data[i + width * 4 + 4 + c]! * fx;
        out[o + c] = top * (1 - fy) + bottom * fy;
      }
    }
  }
  return out;
}

/**
 * Makes a clean rendered page look scanned or photographed. Everything is kept gentle:
 * a heavy filter is the quickest way to make a page look fake.
 */
export function applyEffects(image: RasterImage, options: EffectOptions): RasterImage {
  const strength = Math.max(0, Math.min(1, options.strength ?? 1));
  const { width, height } = image;
  if (strength === 0) return { width, height, data: new Uint8ClampedArray(image.data) };

  const rng = createRng(`${options.seed ?? 0}/effects/${options.mode}`);
  const photo = options.mode === 'photo';

  // Chosen once per page.
  const turn = rng.float(-1, 1) * (photo ? 1.2 : 0.35) * strength;
  const lightAngle = rng.float(0, Math.PI * 2);
  const lightX = Math.cos(lightAngle);
  const lightY = Math.sin(lightAngle);
  const creaseY = rng.float(0.35, 0.65) * height;
  const creaseWidth = height * 0.006;

  const falloff = (photo ? 0.14 : 0.03) * strength;
  const vignette = (photo ? 0.12 : 0) * strength;
  const noise = (photo ? 5 : 2.5) * strength;
  // Paper and camera are never neutral white: scans run slightly cool-grey, photos warm.
  const tint = photo ? [1, 0.985, 0.94] : [0.985, 0.985, 0.975];
  const tone = tint.map((t) => 1 - (1 - t) * strength);
  const base = 1 - (photo ? 0.04 : 0.015) * strength;

  const data = rotate(image, turn);
  for (let y = 0; y < height; y++) {
    const v = (y / (height - 1)) * 2 - 1;
    let fold = 0;
    if (options.crease) {
      // Shadow on one side of the fold, a highlight on the other.
      const d = (y - creaseY) / creaseWidth;
      fold = -Math.sign(d) * Math.exp(-d * d) * 0.07 * strength;
    }
    for (let x = 0; x < width; x++) {
      const u = (x / (width - 1)) * 2 - 1;
      const light =
        base *
          (1 - falloff * (0.5 + 0.5 * (u * lightX + v * lightY))) *
          (1 - vignette * (u * u + v * v) * 0.5) +
        fold;
      // One noise value for all channels: luminance grain, not colour speckle.
      const grain = rng.float(-noise, noise);
      const o = (y * width + x) * 4;
      data[o] = clamp(data[o]! * light * tone[0]! + grain);
      data[o + 1] = clamp(data[o + 1]! * light * tone[1]! + grain);
      data[o + 2] = clamp(data[o + 2]! * light * tone[2]! + grain);
    }
  }
  return { width, height, data };
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Encodes raw pixels as a PNG file. Works in Node and in browsers. */
export async function encodePng(image: RasterImage): Promise<Uint8Array> {
  const { width, height, data } = image;
  // Each row is prefixed with a filter byte (0: none).
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const packed = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'));
  const compressed = new Uint8Array(await new Response(packed).arrayBuffer());

  const chunk = (type: string, body: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + body.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(body, 8);
    view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
    return out;
  };

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8); // 8 bits per channel, RGBA

  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', compressed),
    chunk('IEND', new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}
