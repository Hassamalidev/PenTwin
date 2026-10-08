import { sceneToSvg, type PageScene } from '@pentwin/engine';

/** Width of the preview image in pixels. Deliberately low: the preview is free. */
export const PREVIEW_WIDTH = 640;

/**
 * Turns one page into a small, watermarked picture for the on-screen preview.
 * The full-quality page is only ever produced by the export worker.
 */
export async function rasterizePreview(scene: PageScene, watermark: string): Promise<string> {
  const svg = sceneToSvg(scene);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The preview could not be drawn.'));
      image.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = PREVIEW_WIDTH;
    canvas.height = Math.round((PREVIEW_WIDTH * scene.height) / scene.width);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The preview could not be drawn.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    // The watermark is part of the picture itself, repeated down the page.
    context.save();
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(-0.5);
    context.font = '700 54px system-ui, sans-serif';
    context.textAlign = 'center';
    context.fillStyle = 'rgba(27, 42, 107, 0.12)';
    for (let y = -canvas.height; y <= canvas.height; y += 190) context.fillText(watermark, 0, y);
    context.restore();

    return canvas.toDataURL('image/jpeg', 0.72);
  } finally {
    URL.revokeObjectURL(url);
  }
}
