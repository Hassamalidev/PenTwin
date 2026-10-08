/** The sentence shown typed and handwritten side by side in the hero. */
export const HERO_TEXT =
  'The experiment was repeated three times and the results were recorded in a table. Each reading was taken after the liquid had settled.';

/**
 * What the live demo starts with, by where it is shown. Each text is also rendered to a
 * picture when the site is built (`/gallery/demo-<key>.png`), so the demo has something
 * to show before the engine is downloaded.
 */
export const DEMO_TEXTS = {
  home: 'Type here and watch it turn into handwriting.',
  tool: 'Paste or type your text here. Try a few sentences and change the style.',
} as const;

/** The part of the page the demo shows, in mm, and the size of its picture in pixels. */
export const DEMO_VIEW = { width: 148, height: 62, pixels: 1100 } as const;

/** The words on the social preview image. */
export const SOCIAL_TEXT = 'Turn any document into your own handwriting.';

/**
 * The gallery: real output of the engine, one picture per entry (rendered by
 * scripts/make-site-assets.ts). `alt` describes the picture for people who cannot see it.
 */
export const GALLERY = [
  {
    id: 'neat',
    title: 'Neat',
    caption: 'Careful, upright writing in gel pen on college-ruled paper.',
    alt: 'A page of neat, upright handwriting in dark gel pen on lined paper, sitting evenly on the lines.',
  },
  {
    id: 'exam',
    title: 'Exam hall',
    caption:
      'Quick writing in black ballpoint that loosens down the page, with a crossed-out slip.',
    alt: 'A page of fast handwriting in black ballpoint on wide-ruled paper with a red margin line and one crossed-out word.',
  },
  {
    id: 'lecture',
    title: 'Lecture notes',
    caption: 'Small, tight pencil writing on narrow ruling.',
    alt: 'A full page of small pencil handwriting on narrow-ruled paper with a margin line.',
  },
  {
    id: 'fountain',
    title: 'Fountain pen',
    caption: 'Ink that runs darker and lighter, on plain paper.',
    alt: 'Handwriting in fountain pen on unlined paper, with the ink visibly darker in some words than others.',
  },
  {
    id: 'dotted',
    title: 'Dotted paper',
    caption: 'Ballpoint on a dot grid.',
    alt: 'Handwriting in blue ballpoint on paper printed with a grid of small dots.',
  },
  {
    id: 'notes',
    title: 'Structured notes',
    caption: 'A heading, bold text, a numbered list and a hand-ruled table.',
    alt: 'Handwritten study notes with a name at the top, an underlined heading, a numbered list and a small table drawn by hand.',
  },
] as const;
