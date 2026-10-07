/** Pixels as a browser canvas or an image decoder hands them over. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** One byte per pixel, 0 = black, 255 = white. */
export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** One byte per pixel, 1 = ink, 0 = paper. */
export interface BinaryImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export function toGray({ width, height, data }: RgbaImage): GrayImage {
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (data[p]! * 77 + data[p + 1]! * 150 + data[p + 2]! * 29) >> 8;
  }
  return { width, height, data: out };
}

/** Shrinks an image to `width` by averaging the source pixels under each target pixel. */
export function shrinkGray(img: GrayImage, width: number): GrayImage {
  if (width >= img.width) return img;
  const scale = img.width / width;
  const height = Math.max(1, Math.round(img.height / scale));
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * scale);
    const y1 = Math.min(img.height, Math.max(y0 + 1, Math.floor((y + 1) * scale)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * scale);
      const x1 = Math.min(img.width, Math.max(x0 + 1, Math.floor((x + 1) * scale)));
      let sum = 0;
      for (let sy = y0; sy < y1; sy++) {
        const row = sy * img.width;
        for (let sx = x0; sx < x1; sx++) sum += img.data[row + sx]!;
      }
      out[y * width + x] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return { width, height, data: out };
}

/** Summed-area table with a one-pixel zero border: any rectangle sum in four lookups. */
export function integralImage({ width, height, data }: GrayImage | BinaryImage): Float64Array {
  const stride = width + 1;
  const out = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += data[y * width + x]!;
      out[(y + 1) * stride + x + 1] = out[y * stride + x + 1]! + rowSum;
    }
  }
  return out;
}

/** Mean of the square window of the given radius around every pixel. */
export function boxBlur(img: GrayImage, radius: number): GrayImage {
  const { width, height } = img;
  const sums = integralImage(img);
  const stride = width + 1;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width, x + radius + 1);
      const sum =
        sums[y1 * stride + x1]! -
        sums[y0 * stride + x1]! -
        sums[y1 * stride + x0]! +
        sums[y0 * stride + x0]!;
      out[y * width + x] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return { width, height, data: out };
}

/** Bilinear sample; coordinates outside the image return `fill`. */
function sample(img: GrayImage, x: number, y: number, fill: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 >= img.width - 1 || y0 >= img.height - 1) return fill;
  const fx = x - x0;
  const fy = y - y0;
  const i = y0 * img.width + x0;
  const top = img.data[i]! * (1 - fx) + img.data[i + 1]! * fx;
  const bottom = img.data[i + img.width]! * (1 - fx) + img.data[i + img.width + 1]! * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Stretches an image to a new size with bilinear interpolation. */
export function resizeGray(img: GrayImage, width: number, height: number): GrayImage {
  const out = new Uint8Array(width * height);
  const sx = (img.width - 1) / Math.max(1, width - 1);
  const sy = (img.height - 1) / Math.max(1, height - 1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = Math.min(img.width - 1.001, x * sx);
      const py = Math.min(img.height - 1.001, y * sy);
      out[y * width + x] = sample(img, px, py, 255);
    }
  }
  return { width, height, data: out };
}

/**
 * Rotates about the centre, keeping the size. Each output pixel is read from the source
 * position turned by `angle` (radians), so content appears turned by `-angle`.
 */
export function rotateGray(img: GrayImage, angle: number, fill = 255): GrayImage {
  const { width, height } = img;
  const out = new Uint8Array(width * height);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  for (let y = 0; y < height; y++) {
    const dy = y - cy;
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      out[y * width + x] = sample(img, cos * dx - sin * dy + cx, sin * dx + cos * dy + cy, fill);
    }
  }
  return { width, height, data: out };
}

export interface Component {
  id: number;
  /** Bounding box; `x1` and `y1` are exclusive. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  area: number;
}

/** Labels 8-connected blobs of ink. `labels` holds each pixel's component id, or -1. */
export function findComponents(img: BinaryImage): { labels: Int32Array; components: Component[] } {
  const { width, height, data } = img;
  const labels = new Int32Array(width * height).fill(-1);
  const components: Component[] = [];
  const stack: number[] = [];

  for (let start = 0; start < data.length; start++) {
    if (!data[start] || labels[start] !== -1) continue;
    const id = components.length;
    const c: Component = { id, x0: width, y0: height, x1: 0, y1: 0, area: 0 };
    labels[start] = id;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop()!;
      const x = i % width;
      const y = (i - x) / width;
      c.area++;
      if (x < c.x0) c.x0 = x;
      if (y < c.y0) c.y0 = y;
      if (x >= c.x1) c.x1 = x + 1;
      if (y >= c.y1) c.y1 = y + 1;
      for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
          const n = ny * width + nx;
          if (data[n] && labels[n] === -1) {
            labels[n] = id;
            stack.push(n);
          }
        }
      }
    }
    components.push(c);
  }
  return { labels, components };
}
