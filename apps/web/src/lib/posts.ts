import { BRAND } from '@pentwin/shared';

export interface Post {
  slug: string;
  title: string;
  description: string;
  /** ISO date. */
  published: string;
  /** Each block is a heading, a paragraph, or a list. Links are written as [text](path). */
  body: ({ h: string } | { p: string } | { list: string[] })[];
}

const name = BRAND.name;

export const POSTS: Post[] = [
  {
    slug: 'how-to-make-text-look-handwritten',
    title: 'How to make text look handwritten',
    description:
      'Four ways to turn typed text into handwriting, from handwriting fonts to tools that use your own letters, and what each one gets wrong.',
    published: '2026-10-08',
    body: [
      {
        p: 'There are four practical ways to get typed text onto a page looking handwritten. They differ a lot in effort and in how convincing the result is.',
      },
      { h: '1. A handwriting font' },
      {
        p: 'The quickest route: pick a script font in your word processor. It takes seconds and looks handwritten from across the room. Up close it does not, because every letter is identical each time it appears and every line is perfectly level.',
      },
      { h: '2. A font made from your own writing' },
      {
        p: 'Several services let you fill in a grid of letters and build a font from it. Now the shapes are yours, which is a real improvement. But it is still a font: one shape per letter, placed mechanically.',
      },
      { h: '3. Write it out' },
      {
        p: 'Nothing beats this for authenticity, and for short texts it is the right answer. The cost is time, and that one mistake on line twenty means starting the page again.',
      },
      { h: '4. A tool that varies your own letters' },
      {
        p: `This is the approach ${name} takes. It collects several versions of each of your letters from one handwritten page, then writes with them the way a hand does: never the same letter shape twice running, the line drifting slightly, spacing changing with the neighbouring letters. You can try it with a sample handwriting in the [free text to handwriting tool](/tools/text-to-handwriting).`,
      },
      { h: 'Which should you use?' },
      {
        list: [
          'A caption or a headline: a handwriting font is fine.',
          'A card or a short letter: write it by hand.',
          'Pages of notes you want in your own writing: a tool that varies your letters.',
        ],
      },
      {
        p: 'Whatever you choose, use it for your own words in your own handwriting. If something has to be handwritten by you, the only honest way is to write it.',
      },
    ],
  },
  {
    slug: 'handwriting-generator-vs-fonts',
    title: 'Handwriting generator vs handwriting fonts',
    description:
      'Why handwriting fonts look printed, what a handwriting generator does differently, and a simple test to tell the two apart.',
    published: '2026-10-08',
    body: [
      {
        p: 'A handwriting font and a handwriting generator can start from the same letter shapes and still produce very different pages. The difference is in what happens after the shapes are chosen.',
      },
      { h: 'What a font does' },
      {
        p: 'A font maps each character to one drawing. The letter "e" is the most common in English; on a page of font text it may appear three hundred times, pixel for pixel the same. Lines sit on a ruler-straight baseline and every gap between two given letters is identical.',
      },
      { h: 'What a generator adds' },
      {
        list: [
          'Variants: several drawings of each letter, with a rule against repeating one immediately.',
          'Warping: each placed letter is bent a little, so even the variants never repeat exactly.',
          'Drift: the line rises and falls smoothly and may tilt, as a hand does without a ruler.',
          'Pair spacing: the gap between two letters depends on which two they are.',
          'Pen behaviour: ink that runs slightly darker and lighter, strokes that swell and thin.',
        ],
      },
      { h: 'A test you can do yourself' },
      {
        p: 'Find the same word twice on the page and compare them closely. In font output the two are identical. In handwriting, and in good generated handwriting, they are recognisably the same word but never the same drawing.',
      },
      { h: 'Being honest about the limits' },
      {
        p: `A generator narrows the gap; it does not close it. Someone who knows your writing well may still notice, especially over many pages. ${name} does not claim otherwise. See the [examples on the home page](/) and judge for yourself, or read [how ${name} makes handwriting look real](/blog/how-${name.toLowerCase()}-makes-handwriting-look-real).`,
      },
    ],
  },
  {
    slug: 'best-paper-styles-for-assignments',
    title: 'Choosing paper: lined, squared, dotted or plain',
    description:
      'Which paper suits which kind of handwritten page: line spacings explained, when squared or dotted paper helps, and margin lines.',
    published: '2026-10-08',
    body: [
      {
        p: 'The paper changes how handwriting reads more than most people expect. Here is what each kind is good for, whether you are writing by hand or printing a handwritten page.',
      },
      { h: 'Lined paper and its three spacings' },
      {
        list: [
          'Wide ruled (about 8.7 mm between lines): easiest to read, suits larger writing and younger writers. Fewer words fit on a page.',
          'College ruled (about 7.1 mm): the everyday choice for notes and essays.',
          'Narrow ruled (about 6.4 mm): fits the most on a page, but only suits small, tidy writing.',
        ],
      },
      {
        p: 'On lined paper the writing should sit on the lines without being glued to them. Handwriting that follows a rule perfectly looks as wrong as handwriting that ignores it.',
      },
      { h: 'Squared paper' },
      {
        p: 'The standard for maths, physics and anything with tables or diagrams, because columns line up by themselves. For running text it is busier to read than lined paper.',
      },
      { h: 'Dotted paper' },
      {
        p: 'A grid of faint dots gives the alignment of squared paper with much less visual noise. Popular for journals and study notes that mix text with sketches.',
      },
      { h: 'Plain paper' },
      {
        p: 'Best for letters and cards. Without lines to follow, writing naturally wanders and tilts more, which is part of its charm, and is why a perfectly level block of text on plain paper looks printed.',
      },
      { h: 'Margin lines' },
      {
        p: 'A vertical margin line gives a clean left edge and leaves room for marks and comments. Many schools expect one. If yours does, use it.',
      },
      {
        p: `All of these are available in the ${name} [editor](/editor), and you can see several in the [text to handwriting tool](/tools/text-to-handwriting).`,
      },
    ],
  },
  {
    slug: `how-${name.toLowerCase()}-makes-handwriting-look-real`,
    title: `How ${name} makes handwriting look real`,
    description: `The techniques behind ${name}: letter variants cut from your own page, smooth drift instead of random noise, pair spacing, and ink.`,
    published: '2026-10-08',
    body: [
      {
        p: 'Making letters look handwritten is easy. Making a page look handwritten is the hard part, because what gives printed "handwriting" away is rarely the letters. It is the regularity.',
      },
      { h: 'Start with your own letters' },
      {
        p: 'You copy a short text by hand and photograph it. The text is chosen so that every lowercase letter appears at least three times. Because we know what you were asked to write, each mark on the page can be matched to its letter. Marks that cannot be matched with confidence are left out rather than guessed, and you see every letter before it is used.',
      },
      { h: 'Never the same shape twice in a row' },
      {
        p: 'With several versions of each letter, the writer picks a different one each time, and bends every placed letter slightly on top. Common letter pairs such as "th" and "er" are also kept as pairs, exactly as you joined them.',
      },
      { h: 'Drift, not noise' },
      {
        p: 'The obvious way to add irregularity is to nudge every letter by a random amount. It looks terrible: jittery, like writing on a bus. A hand does not jump. It drifts, slowly, and corrects. So the baseline, the letter size and the lean all change smoothly along a line, with only a little quick variation on top.',
      },
      { h: 'Spacing by letter pair' },
      {
        p: 'The gap between two letters depends on which two they are, and stays consistent for that pair throughout a document, the way a real writer\u2019s habits do.',
      },
      { h: 'A hand gets tired' },
      {
        p: 'Optionally, writing loosens gradually from the top of a page to the bottom, and an occasional word is started wrong, crossed out and rewritten. Numbers, names and anything capitalised are never touched by this, so the meaning of your text cannot change.',
      },
      { h: 'What it does not do' },
      {
        p: 'It does not work well with fully joined-up writing yet, it does not invent letters you never wrote without telling you, and it does not promise that nobody can tell. Try the [free tool](/tools/text-to-handwriting), or see [how it compares with fonts](/blog/handwriting-generator-vs-fonts).',
      },
    ],
  },
];
