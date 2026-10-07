import { inkFilter } from './ink';
import { serializePath, type PathCommand } from './path';
import type { PageScene } from './render';

export interface InkGroup {
  mode: 'stroke' | 'fill' | 'both';
  /** Pen width in mm; 0 when the group is only filled. */
  width: number;
  opacity: number;
  paths: PathCommand[][];
}

const MODE_ORDER = { stroke: 0, fill: 1, both: 2 } as const;

/**
 * Groups the ink by how it is painted: mode, pen width (to 0.01mm) and opacity (to 0.05).
 * A page can then be drawn with a handful of path elements instead of one per glyph,
 * which keeps SVG and PDF output small.
 */
export function groupInk(scene: PageScene): InkGroup[] {
  const groups = new Map<string, InkGroup>();
  for (const stroke of scene.strokes) {
    const mode = stroke.mode ?? scene.paint;
    const width = mode === 'fill' ? 0 : Math.round(stroke.width * 100) / 100;
    const opacity = Math.round((stroke.opacity ?? 1) * 20) / 20;
    const key = `${mode}/${width}/${opacity}`;
    const group = groups.get(key);
    if (group) group.paths.push(stroke.path);
    else groups.set(key, { mode, width, opacity, paths: [stroke.path] });
  }
  return [...groups.values()].sort(
    (a, b) => MODE_ORDER[a.mode] - MODE_ORDER[b.mode] || a.width - b.width || a.opacity - b.opacity,
  );
}

/** Renders a page as a standalone SVG document sized in millimetres. */
export function sceneToSvg(scene: PageScene): string {
  const { width, height, inkColor } = scene;
  const open = {
    stroke: `<g fill="none" stroke="${inkColor}" stroke-linecap="round" stroke-linejoin="round">`,
    fill: `<g fill="${inkColor}" stroke="none">`,
    both: `<g fill="${inkColor}" stroke="${inkColor}" stroke-linejoin="round">`,
  };

  const ink: string[] = [];
  let current: InkGroup['mode'] | undefined;
  for (const group of groupInk(scene)) {
    if (group.mode !== current) {
      if (current) ink.push('</g>');
      ink.push(open[group.mode]);
      current = group.mode;
    }
    const attributes =
      (group.mode === 'fill' ? '' : ` stroke-width="${group.width}"`) +
      (group.opacity < 1 ? ` opacity="${group.opacity}"` : '');
    const d = group.paths.map((path) => serializePath(path)).join('');
    ink.push(`<path${attributes} d="${d}"/>`);
  }
  // An empty page still gets its (empty) ink group, so the document shape is constant.
  if (!current) ink.push(open[scene.paint]);
  ink.push('</g>');

  const filter = scene.inkEffects && inkFilter(scene.inkEffects, width, height);
  if (filter) {
    ink.unshift(`<defs>${filter}</defs>`, '<g filter="url(#ink)">');
    ink.push('</g>');
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="${scene.paper.background}"/>`,
    ...scene.paper.layers.map(
      (l) =>
        `<path fill="none" stroke="${l.color}" stroke-width="${l.width}" stroke-linecap="round" d="${l.d}"/>`,
    ),
    ...ink,
    '</svg>',
    '',
  ].join('\n');
}
