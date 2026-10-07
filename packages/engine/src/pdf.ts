import { MM_TO_PT } from '@pentwin/shared';
import { PDFDocument } from 'pdf-lib';
import { parsePath, type PathCommand } from './path';
import type { PageScene } from './render';
import { groupInk } from './svg';

const n = (v: number): string => String(Math.round(v * 100) / 100);

const color = (hex: string): string => {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => (c / 255).toFixed(3)).join(' ');
};

/** PDF path construction operators for a path. PDF has no quadratic curves, so Q becomes c. */
function pathOperators(path: readonly PathCommand[]): string {
  let out = '';
  let x = 0;
  let y = 0;
  for (const c of path) {
    switch (c.type) {
      case 'M':
        out += `${n(c.x)} ${n(c.y)} m\n`;
        break;
      case 'L':
        out += `${n(c.x)} ${n(c.y)} l\n`;
        break;
      case 'C':
        out += `${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)} c\n`;
        break;
      case 'Q':
        out +=
          `${n(x + (2 / 3) * (c.x1 - x))} ${n(y + (2 / 3) * (c.y1 - y))} ` +
          `${n(c.x + (2 / 3) * (c.x1 - c.x))} ${n(c.y + (2 / 3) * (c.y1 - c.y))} ` +
          `${n(c.x)} ${n(c.y)} c\n`;
        break;
      case 'Z':
        out += 'h\n';
        continue;
    }
    x = c.x;
    y = c.y;
  }
  return out;
}

/** The page's whole content stream, written in scene coordinates (mm, origin top-left). */
function pageContent(scene: PageScene): string {
  const parts = [
    'q',
    // Flip the y axis and scale mm to points. Line widths below are therefore in mm too.
    `${MM_TO_PT} 0 0 ${-MM_TO_PT} 0 ${scene.height * MM_TO_PT} cm`,
    '1 J 1 j', // round caps and joins
  ];

  if (scene.paper.background.toLowerCase() !== '#ffffff') {
    parts.push(`${color(scene.paper.background)} rg 0 0 ${n(scene.width)} ${n(scene.height)} re f`);
  }
  for (const layer of scene.paper.layers) {
    parts.push(
      `${color(layer.color)} RG ${n(layer.width)} w`,
      pathOperators(parsePath(layer.d)),
      'S',
    );
  }

  const filled = scene.paint === 'fill';
  parts.push(`${color(scene.inkColor)} ${filled ? 'rg' : 'RG'}`);
  for (const { width, paths } of groupInk(scene)) {
    if (!filled) parts.push(`${n(width)} w`);
    parts.push(paths.map(pathOperators).join(''), filled ? 'f' : 'S');
  }

  parts.push('Q');
  return parts.join('\n');
}

/** zlib-compresses text with the platform's native implementation (Node and browsers). */
async function deflate(text: string): Promise<Uint8Array> {
  const compressed = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(compressed).arrayBuffer());
}

/**
 * Writes the pages to a PDF. Everything stays vector: the ink and the paper pattern are
 * drawn as paths, so the file is small and sharp at any zoom.
 *
 * The content streams are written and compressed here rather than through pdf-lib's
 * drawing helpers: its JavaScript deflate alone took about half a second per page.
 */
export async function scenesToPdf(scenes: readonly PageScene[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const scene of scenes) {
    const page = doc.addPage([scene.width * MM_TO_PT, scene.height * MM_TO_PT]);
    const content = await deflate(pageContent(scene));
    page.node.addContentStream(
      doc.context.register(doc.context.stream(content, { Filter: 'FlateDecode' })),
    );
  }
  return doc.save();
}
