import { Resvg } from '@resvg/resvg-js';
import type { PageScene } from '../render';
import { sceneToSvg } from '../svg';

const rasterize = (scene: PageScene, dpi: number) =>
  new Resvg(sceneToSvg(scene), {
    fitTo: { mode: 'width', value: Math.round((scene.width / 25.4) * dpi) },
  }).render();

/** Rasterizes a page to PNG at the given resolution. */
export function sceneToPng(scene: PageScene, dpi = 150): Uint8Array {
  return rasterize(scene, dpi).asPng();
}

/** Rasterizes a page to raw RGBA pixels. */
export function sceneToPixels(
  scene: PageScene,
  dpi = 150,
): { width: number; height: number; data: Uint8Array } {
  const image = rasterize(scene, dpi);
  return { width: image.width, height: image.height, data: image.pixels };
}
