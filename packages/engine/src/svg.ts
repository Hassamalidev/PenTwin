import { serializePath, type PathCommand } from './path';
import type { PageScene } from './render';

/**
 * Groups the ink by pen width (rounded to 0.01mm). A page can then be drawn with a handful
 * of path elements instead of one per glyph, which keeps SVG and PDF output small.
 */
export function groupInk(scene: PageScene): { width: number; paths: PathCommand[][] }[] {
  const groups = new Map<number, PathCommand[][]>();
  for (const stroke of scene.strokes) {
    const width = scene.paint === 'fill' ? 0 : Math.round(stroke.width * 100) / 100;
    const group = groups.get(width) ?? [];
    group.push(stroke.path);
    groups.set(width, group);
  }
  return [...groups].sort(([a], [b]) => a - b).map(([width, paths]) => ({ width, paths }));
}

/** Renders a page as a standalone SVG document sized in millimetres. */
export function sceneToSvg(scene: PageScene): string {
  const { width, height } = scene;
  const filled = scene.paint === 'fill';
  const ink = filled
    ? `<g fill="${scene.inkColor}" stroke="none">`
    : `<g fill="none" stroke="${scene.inkColor}" stroke-linecap="round" stroke-linejoin="round">`;
  const paths = groupInk(scene).map(({ width: w, paths: group }) => {
    const d = group.map((path) => serializePath(path)).join('');
    return filled ? `<path d="${d}"/>` : `<path stroke-width="${w}" d="${d}"/>`;
  });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="${scene.paper.background}"/>`,
    ...scene.paper.layers.map(
      (l) =>
        `<path fill="none" stroke="${l.color}" stroke-width="${l.width}" stroke-linecap="round" d="${l.d}"/>`,
    ),
    ink,
    ...paths,
    '</g>',
    '</svg>',
    '',
  ].join('\n');
}
