import type { Seed } from '@pentwin/shared';
import jpeg from 'jpeg-js';
import { finishPage, type FinishMode } from '../finish';
import { picturesToPdf, type PagePicture, type PdfOptions } from '../pdf';
import type { PageScene } from '../render';
import { sceneToPixels } from './png';

export interface FinishedPdfOptions extends PdfOptions {
  finish: Exclude<FinishMode, 'none'>;
  seed: Seed;
  /** Dots per inch of the page pictures. */
  dpi?: number;
  /** JPEG quality, 1 to 100. */
  quality?: number;
}

/**
 * Writes pages as finished pictures: vector strokes are perfect under a magnifier, a
 * scanned page is not. Pages are made one at a time, and only the page before is kept
 * in memory (it shows through the next one).
 */
export async function scenesToFinishedPdf(
  scenes: readonly PageScene[],
  options: FinishedPdfOptions,
): Promise<Uint8Array> {
  const dpi = options.dpi ?? 200;
  const pictures: PagePicture[] = [];
  let backside: ReturnType<typeof sceneToPixels> | undefined;
  for (const [index, scene] of scenes.entries()) {
    // Grain and bleed are made here, on the whole page, not in the ink's SVG filter.
    const clean = sceneToPixels({ ...scene, inkEffects: undefined }, dpi);
    const finished = finishPage(clean, {
      mode: options.finish,
      seed: `${options.seed}/${index}`,
      pxPerMm: dpi / 25.4,
      patch: scene.inkEffects?.grain ?? 0,
      ...(backside ? { backside } : {}),
    });
    const encoded = jpeg.encode(
      { data: finished.data as Uint8Array, width: finished.width, height: finished.height },
      options.quality ?? 85,
    );
    pictures.push({ jpeg: encoded.data, width: scene.width, height: scene.height });
    backside = clean;
    // Lets the server answer health checks between pages.
    await new Promise((resolve) => setImmediate(resolve));
  }
  return picturesToPdf(pictures, options.watermark ? { watermark: options.watermark } : {});
}
