import { MM_TO_PT } from '@pentwin/shared';
import { LineCapStyle, LineJoinStyle, PDFDocument, rgb, setLineJoin, type RGB } from 'pdf-lib';
import type { PageScene } from './render';
import { groupInk } from './svg';

const hexToRgb = (hex: string): RGB => {
  const v = parseInt(hex.replace('#', ''), 16);
  return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
};

/**
 * Writes the pages to a PDF. Everything stays vector: the ink and the paper pattern are
 * drawn as paths, so the file is small and sharp at any zoom.
 */
export async function scenesToPdf(scenes: readonly PageScene[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();

  for (const scene of scenes) {
    const page = doc.addPage([scene.width * MM_TO_PT, scene.height * MM_TO_PT]);
    // Scene coordinates are mm from the top-left; `scale` also applies to line widths.
    const frame = { x: 0, y: page.getHeight(), scale: MM_TO_PT };
    page.pushOperators(setLineJoin(LineJoinStyle.Round));

    if (scene.paper.background.toLowerCase() !== '#ffffff') {
      page.drawRectangle({
        width: page.getWidth(),
        height: page.getHeight(),
        color: hexToRgb(scene.paper.background),
      });
    }
    for (const layer of scene.paper.layers) {
      page.drawSvgPath(layer.d, {
        ...frame,
        borderColor: hexToRgb(layer.color),
        borderWidth: layer.width,
        borderLineCap: LineCapStyle.Round,
      });
    }

    const ink = hexToRgb(scene.inkColor);
    for (const { width, d } of groupInk(scene)) {
      page.drawSvgPath(
        d,
        scene.paint === 'fill'
          ? { ...frame, color: ink }
          : { ...frame, borderColor: ink, borderWidth: width, borderLineCap: LineCapStyle.Round },
      );
    }
  }

  return doc.save();
}
