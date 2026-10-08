import { BRAND, PLANS } from '@pentwin/shared';
import type { FaqItem } from './faq';
import type { GALLERY } from './gallery';

/** A landing page built from sections. Each one has its own wording; none is a template of another. */
export interface ContentPage {
  path: string;
  /** Short name, for breadcrumbs and links. */
  name: string;
  title: string;
  description: string;
  heading: string;
  lead: string;
  /** Show the live demo on this page. */
  demo?: boolean;
  sections: { heading: string; paragraphs?: string[]; steps?: string[]; bullets?: string[] }[];
  gallery?: readonly (typeof GALLERY)[number]['id'][];
  faq: FaqItem[];
  cta: { label: string; href: string };
}

const name = BRAND.name;

export const TOOL_PAGES: ContentPage[] = [
  {
    path: '/tools/text-to-handwriting',
    name: 'Text to handwriting',
    title: 'Text to handwriting converter, free',
    description:
      'Type or paste text and see it handwritten instantly. Free, no sign-up, runs in your browser. Add your own handwriting to write in it.',
    heading: 'Text to handwriting',
    lead: 'Type below and watch your words turn into handwriting as you go. It is free, needs no account, and what you type stays in your browser.',
    demo: true,
    sections: [
      {
        heading: 'How this converter differs from a handwriting font',
        paragraphs: [
          'A handwriting font has one shape for each letter. Type "banana" and all three a\u2019s are identical, lined up on a perfectly straight row. That sameness is what makes font output look printed.',
          `${name} keeps several versions of every letter and never uses the same one twice running. Each letter is also bent very slightly, the row drifts up and down a little, and the gaps between letters change with the letters on either side.`,
        ],
      },
      {
        heading: 'From this demo to your own handwriting',
        steps: [
          'Copy a short printed text by hand and photograph the page.',
          'Your letters are cut out of the photo on your device and shown to you to check.',
          'Everything you type or upload is then written with your letters instead of the demo ones.',
        ],
      },
      {
        heading: 'What you can change',
        bullets: [
          'Writing style: neat, normal, rushed, exam hall or lecture notes.',
          'Pen: blue or black ballpoint, gel, fountain pen or pencil.',
          'Paper: lined in three spacings, squared, dotted or plain, with or without a margin line.',
          'Page size, writing size, and how uneven the writing is.',
        ],
      },
    ],
    gallery: ['neat', 'fountain', 'dotted'],
    faq: [
      {
        question: 'Is the text to handwriting tool free?',
        answer: `Yes. This demo and the preview in the editor are free and unlimited. Exporting finished pages as a PDF uses credits; the free plan includes ${PLANS.free.monthlyPages} watermarked pages a month.`,
      },
      {
        question: 'Does the text I type get uploaded?',
        answer:
          'No. The demo runs in your browser and nothing you type here is sent anywhere. Text is only sent to our server when you choose to export a PDF from the editor.',
      },
      {
        question: 'Can I download the result from this page?',
        answer:
          'This page is a preview. To download a full-quality PDF, open the editor, where you can also upload Word and PDF files.',
      },
    ],
    cta: { label: 'Open the full editor', href: '/editor' },
  },
  {
    path: '/tools/pdf-to-handwriting',
    name: 'PDF to handwriting',
    title: 'PDF to handwriting converter',
    description:
      'Upload a PDF and get it back handwritten. Columns, page headers and broken lines are cleaned up into paragraphs first. Preview free.',
    heading: 'PDF to handwriting',
    lead: 'Upload a PDF and its text is rewritten by hand. The awkward part of PDFs, getting clean text out of them, is handled for you.',
    sections: [
      {
        heading: 'Why PDFs need cleaning first',
        paragraphs: [
          'A PDF does not store paragraphs. It stores fragments of text with positions on a page. Copy text out of one and you get lines broken in odd places, words split by hyphens, page numbers in the middle of sentences, and two columns shuffled together.',
          'Writing that out by hand, line break for line break, would look nothing like something a person wrote. So the text is rebuilt first.',
        ],
      },
      {
        heading: 'What the converter fixes',
        bullets: [
          'Two-column pages are read down the left column, then the right.',
          'Running headers, footers and page numbers that repeat on every page are removed.',
          'Words hyphenated across a line break are joined back together.',
          'Lines are merged into paragraphs, including paragraphs that continue onto the next page.',
          'Larger text is recognised as headings.',
        ],
      },
      {
        heading: 'What it cannot read',
        paragraphs: [
          'Only PDFs with real, selectable text can be read. A scanned PDF is a set of pictures of pages; if you cannot select text in it with your mouse, there is no text to extract. You are told which pages were skipped for that reason rather than getting an empty result.',
          'Pictures, tables and the original layout of a PDF are not carried over: you get the text, as headings and paragraphs, ready to check and edit before it is written out.',
        ],
      },
    ],
    gallery: ['lecture', 'neat'],
    faq: [
      {
        question: 'Can I convert a scanned PDF to handwriting?',
        answer:
          'Not yet. Scanned pages have no text layer to read. If your PDF came from a scanner or a photo, type or paste the text instead, or export it from the original document.',
      },
      {
        question: 'Will the handwritten version have the same page breaks as my PDF?',
        answer:
          'No. Handwriting takes a different amount of space than print, so the text flows onto as many pages as it needs. You can add your own page breaks in the editor.',
      },
      {
        question: 'Is my PDF uploaded to a server?',
        answer:
          'Reading the PDF happens in your browser. The text is sent to our server only when you export, and the finished file is deleted within 24 hours.',
      },
    ],
    cta: { label: 'Upload a PDF', href: '/editor' },
  },
  {
    path: '/tools/word-to-handwriting',
    name: 'Word to handwriting',
    title: 'Word to handwriting converter (DOCX)',
    description:
      'Convert a Word document to handwriting and keep its structure: headings, bold, bulleted and numbered lists, tables and pictures.',
    heading: 'Word to handwriting',
    lead: 'Upload a .docx file and it is written out by hand with its structure intact: headings stay headings, lists stay lists, and tables are ruled by hand.',
    sections: [
      {
        heading: 'What carries over from your document',
        bullets: [
          'Headings, written larger; main headings are underlined, as people do on paper.',
          'Bold text, written with a heavier stroke, and italics, written with more lean.',
          'Bulleted lists with dashes and numbered lists with handwritten numbers.',
          'Tables, with slightly uneven hand-drawn lines.',
          'Pictures (PNG and JPEG), placed on the page where they were.',
        ],
      },
      {
        heading: 'What does not',
        paragraphs: [
          'Fonts, colours, text boxes, footnotes, comments and page layout are left behind on purpose: a handwritten page has none of them. If a picture is in a format that cannot be used, you are told so instead of it quietly disappearing.',
          'Typographic characters are turned into what a pen writes: curly quotes become straight ones, long dashes become hyphens. Anything your handwriting has no letter for, such as emoji or unusual symbols, is listed for you before you export.',
        ],
      },
      {
        heading: 'Editing before you export',
        paragraphs: [
          'After upload, each heading, paragraph, list and table is its own block. You can fix the text, leave a block out, change a heading\u2019s size, or force a page break after any block. The preview follows every change.',
        ],
      },
    ],
    gallery: ['notes', 'exam'],
    faq: [
      {
        question: 'Does it work with .doc files?',
        answer:
          'Only .docx. Open the old .doc file in Word, Google Docs or LibreOffice, save it as .docx, and upload that.',
      },
      {
        question: 'Can I convert a Google Doc?',
        answer:
          'Yes: in Google Docs choose File, Download, Microsoft Word (.docx), then upload the downloaded file.',
      },
      {
        question: 'How many pages will my document become?',
        answer:
          'It depends on the writing size and paper. The editor shows the exact page count, and the export window shows it again with the cost, before you commit to anything.',
      },
    ],
    cta: { label: 'Upload a Word file', href: '/editor' },
  },
];

export const AUDIENCE_PAGES: ContentPage[] = [
  {
    path: '/for/university-students',
    name: 'For university students',
    title: 'Handwriting generator for university students',
    description:
      'Turn typed lecture notes and summaries into your own handwriting for revision. Built for long documents, with a student plan.',
    heading: 'For university students',
    lead: 'You think faster at a keyboard, but you remember better from your own handwriting. Type your notes, then keep them in your hand.',
    sections: [
      {
        heading: 'Where it helps',
        bullets: [
          'Revision notes: type and reorganise them properly, then print them in your own writing for the last week before exams.',
          'Summaries and formula sheets you want in a familiar hand.',
          'Lab books and reflective journals where you are allowed to prepare text digitally.',
          'Letters and cards, where handwriting is the point.',
        ],
      },
      {
        heading: 'Where it does not belong',
        paragraphs: [
          'If a piece of work must be written by hand by you, such as a handwritten exam, a signed declaration, or coursework your department requires in manuscript, then generating it is not doing it, and may be an academic offence. Check your course rules. The tool will not help you there, and we ask you not to use it that way.',
        ],
      },
      {
        heading: 'Built for long documents',
        paragraphs: [
          `The Student plan covers ${PLANS.student.monthlyPages} pages a month, enough for a full set of course notes. Previews are free, so you only spend pages on the final export, and you see the exact count first.`,
          'The "Lecture notes" style writes small and tight on narrow ruling, the way notes taken in a hurry look. Writing loosens gradually down a long page, as it does when a hand tires.',
        ],
      },
    ],
    gallery: ['lecture', 'notes'],
    faq: [
      {
        question: 'Is there a student discount?',
        answer: `The Student plan is the discount: ${PLANS.student.monthlyPages} pages a month at the lowest paid price, with no watermark.`,
      },
      {
        question: 'Can I use it for assignments?',
        answer:
          'Only where typed or prepared work is allowed. If the assignment has to be handwritten by you, using a generator would misrepresent it. When in doubt, ask your tutor.',
      },
      {
        question: 'Does it handle equations?',
        answer:
          'Only what can be written with ordinary keyboard characters, such as x = 2y + 3. Symbols your handwriting sample does not include are listed before export so nothing goes missing unnoticed.',
      },
    ],
    cta: { label: 'Try it with your notes', href: '/editor' },
  },
  {
    path: '/for/school-projects',
    name: 'For school projects',
    title: 'Handwritten pages for school projects',
    description:
      'Make neat handwritten pages for posters, scrapbooks and project folders from typed text, on lined, squared or dotted paper.',
    heading: 'For school projects',
    lead: 'Posters, scrapbooks and project folders often look best handwritten. Type the text once, get it right, then print it in handwriting that fits on the page.',
    sections: [
      {
        heading: 'Good uses',
        bullets: [
          'Captions and labels for a poster or display board, all the same size and straight.',
          'Scrapbook and journal pages.',
          'A fair copy of a story or report you have already written and corrected.',
          'Practice sheets: print a sentence in neat handwriting to copy underneath.',
        ],
      },
      {
        heading: 'For parents and teachers',
        paragraphs: [
          'This is a presentation tool, not a way around handwriting practice. If the task is to practise writing, or the teacher has asked for work written by hand, it should be written by hand. We say this to every user, and the same note appears when exporting.',
          'A handwriting profile is made from a photo of one handwritten page. The photo is processed on the device and is not uploaded. Younger children should set it up with an adult.',
        ],
      },
      {
        heading: 'Paper that matches the exercise book',
        paragraphs: [
          'Choose lined paper in narrow, college or wide spacing, squared paper, dotted paper or plain, with an optional margin line. The "Neat" style keeps letters upright and evenly on the line, which suits display work.',
        ],
      },
    ],
    gallery: ['neat', 'dotted'],
    faq: [
      {
        question: 'Is it free for a school project?',
        answer: `The free plan gives ${PLANS.free.monthlyPages} pages a month with a small watermark, which is enough for most single projects. Previews are always free.`,
      },
      {
        question: 'Can it copy my teacher\u2019s or a friend\u2019s handwriting?',
        answer:
          'No. It is only for your own handwriting, and you are asked to confirm that when you add a sample. Imitating someone else\u2019s writing is against the rules of the service.',
      },
      {
        question: 'Does it work on a phone?',
        answer:
          'Yes. You can take the photo of your handwriting, edit text and export from a phone browser.',
      },
    ],
    cta: { label: 'Start a page', href: '/editor' },
  },
];

export const CONTENT_PAGES: ContentPage[] = [...TOOL_PAGES, ...AUDIENCE_PAGES];
