import { BRAND, PLANS, REFERRAL_BONUS_PAGES, TOP_UP } from '@pentwin/shared';
import { SUPPORT_EMAIL } from './site';

export interface FaqItem {
  question: string;
  /** Plain text. Used on the page and, word for word, in the structured data. */
  answer: string;
}

const name = BRAND.name;

/** Questions about pages and paying, shown on the pricing page. */
export const CREDIT_FAQ: FaqItem[] = [
  {
    question: 'What is a credit?',
    answer:
      'One credit is one exported page. Previews in the editor are free and unlimited: you only use credits when you export the finished PDF.',
  },
  {
    question: 'Do I see the cost before I export?',
    answer:
      'Yes. The export window shows the exact number of pages and credits before anything is charged, and exporting the same document again within 24 hours is free.',
  },
  {
    question: 'Do unused pages carry over?',
    answer: `The pages included in a plan reset each month and do not carry over. Top-up pages (${TOP_UP.pages} at a time) and referral bonuses (${REFERRAL_BONUS_PAGES} pages) never expire and are used only after your monthly pages run out.`,
  },
  {
    question: 'What happens if an export fails?',
    answer:
      'You are not charged. Pages are only kept for exports that finished and can be downloaded.',
  },
  {
    question: 'What does the free plan include?',
    answer: `${PLANS.free.monthlyPages} pages a month with a watermark, one handwriting profile, and the basic pens. It is enough to see your own handwriting on a real page before paying for anything.`,
  },
  {
    question: 'Can I cancel?',
    answer:
      'Yes, at any time. You keep your plan until the end of the period you have paid for, then move to the free plan. Your handwriting and documents are not deleted.',
  },
];

/** General questions, shown on the FAQ page. */
export const GENERAL_FAQ: FaqItem[] = [
  {
    question: `How does ${name} work?`,
    answer:
      'You copy a short text by hand on plain paper and take a photo. Your letters are cut out of that photo and stored as your handwriting. Any document you then upload is written out with those letters, with the small irregularities real handwriting has.',
  },
  {
    question: 'Which files can I upload?',
    answer:
      'Word documents (.docx), PDFs that contain selectable text, and plain text files. You can also type or paste text directly. Old .doc files need saving as .docx first, and scanned PDFs (pictures of pages) are not read yet.',
  },
  {
    question: 'Is it really my handwriting?',
    answer:
      'The letter shapes are yours, taken from your sample. What the software adds is the arrangement: spacing, the line drifting slightly, letters varying from one to the next. It works best with letters written separately; fully joined-up writing is not well supported yet.',
  },
  {
    question: 'Can anyone tell it was generated?',
    answer:
      'We do not claim it cannot be told apart from writing done by hand, and you should not rely on that. Someone who knows your handwriting well, or who looks closely at a long document, may notice. It is a tool for producing a handwritten version of your own text, not for deceiving anyone.',
  },
  {
    question: 'Who sees my handwriting?',
    answer:
      'Your sample photo is processed on your own device and is not uploaded. Your letter shapes are sent to our server only when you export, together with the document, to write the PDF; the finished file is kept for up to 24 hours so you can download it. Your handwriting is never shared with other users, and you can delete it at any time.',
  },
  {
    question: `What may I not use ${name} for?`,
    answer:
      "Only upload handwriting that is your own. Do not use it to imitate another person's writing, to forge signatures or documents, or to break the rules of your school, university or employer. If an assignment has to be written by hand by you, generating it is not doing that.",
  },
  {
    question: 'What if a character in my document cannot be written?',
    answer:
      'Before you export, you get a list of anything your handwriting cannot write, such as emoji, some maths symbols or other alphabets. Nothing is dropped silently. You can add missing characters by writing a short top-up sheet.',
  },
  {
    question: 'Can I get a refund?',
    answer: `Yes. If you are not satisfied, ask within 7 days of a payment at ${SUPPORT_EMAIL} and we will refund it.`,
  },
];

/** Structured data for a list of questions. */
export const faqJsonLd = (items: FaqItem[]) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: items.map((item) => ({
    '@type': 'Question',
    name: item.question,
    acceptedAnswer: { '@type': 'Answer', text: item.answer },
  })),
});
