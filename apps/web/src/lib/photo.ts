import type { RgbaImage } from '@pentwin/extractor';
import { sniffFileKind } from '@pentwin/shared';

/** Photos are shrunk to this many pixels on their longer side before processing. */
const MAX_SIDE = 2600;
/** Phone photos are a few megabytes. Anything far beyond that is not a photo of a page. */
export const MAX_PHOTO_BYTES = 30 * 1024 * 1024;
const NOT_A_PICTURE = 'This file is not a picture we can read. Use a JPEG or PNG photo.';

/** Decodes a photo chosen or taken by the user into raw pixels, in the browser. */
export async function readPhoto(file: File): Promise<RgbaImage> {
  if (file.size > MAX_PHOTO_BYTES) {
    throw new Error('This photo is larger than 30 MB. Please use a smaller one.');
  }
  // Only real pictures reach the decoder, whatever the file is called.
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!['jpeg', 'png', 'webp'].includes(sniffFileKind(head))) throw new Error(NOT_A_PICTURE);

  let bitmap: ImageBitmap;
  try {
    // Honour the rotation a phone records, so a portrait photo arrives upright.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(NOT_A_PICTURE);
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
