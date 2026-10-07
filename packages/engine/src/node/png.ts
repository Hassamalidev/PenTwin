import { Resvg } from '@resvg/resvg-js';
import type { PageScene } from '../render';
import { sceneToSvg } from '../svg';

/** Rasterizes a page to PNG at the given resolution. */
export function sceneToPng(scene: PageScene, dpi = 150): Uint8Array {
  const widthPx = Math.round((scene.width / 25.4) * dpi);
  return new Resvg(sceneToSvg(scene), { fitTo: { mode: 'width', value: widthPx } })
    .render()
    .asPng();
}
