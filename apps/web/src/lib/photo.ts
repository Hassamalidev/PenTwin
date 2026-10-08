import type { RgbaImage } from '@pentwin/extractor';

/** Photos are shrunk to this many pixels on their longer side before processing. */
const MAX_SIDE = 2600;

/** Decodes a photo chosen or taken by the user into raw pixels, in the browser. */
export async function readPhoto(file: File): Promise<RgbaImage> {
  let bitmap: ImageBitmap;
  try {
    // Honour the rotation a phone records, so a portrait photo arrives upright.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This file is not a picture we can read. Use a JPEG or PNG photo.');
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('The photo could not be read on this device.');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
  return { data, width, height };
}

/** A file made in the browser, offered as a download. */
export function downloadBytes(bytes: Uint8Array, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
