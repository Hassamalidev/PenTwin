import { Resvg } from '@resvg/resvg-js';
import type { PageScene } from '../render';
import { sceneToSvg } from '../svg';

export interface Pixels {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel. */
  data: Uint8Array;
}

const rasterize = (svg: string, widthPx: number) =>
  new Resvg(svg, { fitTo: { mode: 'width', value: widthPx } }).render();

const widthAt = (scene: PageScene, dpi: number): number => Math.round((scene.width / 25.4) * dpi);

/** Rasterizes a page to PNG at the given resolution. */
export function sceneToPng(scene: PageScene, dpi = 150): Uint8Array {
  return rasterize(sceneToSvg(scene), widthAt(scene, dpi)).asPng();
}

/** Rasterizes a page to raw RGBA pixels. */
export function sceneToPixels(scene: PageScene, dpi = 150): Pixels {
  return svgToPixels(sceneToSvg(scene), widthAt(scene, dpi));
}

/** Rasterizes any SVG document to raw RGBA pixels, `widthPx` pixels wide. */
export function svgToPixels(svg: string, widthPx: number): Pixels {
  const image = rasterize(svg, widthPx);
  return { width: image.width, height: image.height, data: image.pixels };
}
