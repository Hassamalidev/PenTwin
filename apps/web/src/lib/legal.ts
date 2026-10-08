import { BRAND } from '@pentwin/shared';
import { SUPPORT_EMAIL } from './site';

/**
 * DRAFTS. These were written to be accurate about what the product does, in plain
 * language, but they have not been reviewed by a lawyer and name no legal entity or
 * governing law yet. They must be reviewed before launch.
 */
export interface LegalPage {
  slug: string;
  name: string;
  title: string;
  description: string;
  sections: { heading: string; paragraphs?: string[]; bullets?: string[] }[];
}

const name = BRAND.name;
export const LEGAL_UPDATED = '8 October 2026';

export const LEGAL_PAGES: LegalPage[] = [
  {
    slug: 'terms',
    name: 'Terms',
    title: 'Terms of service',
    description: `The terms for using ${name}: your account, your content, plans and payment, and what the service may not be used for.`,
    sections: [
      {
        heading: 'The service',
        paragraphs: [
          `${name} turns text and documents you provide into pages written in handwriting made from a sample you provide. These terms apply whenever you use it. If you do not agree with them, please do not use the service.`,
        ],
      },
      {
        heading: 'Your handwriting and your content',
        paragraphs: [
          'You keep all rights to your handwriting sample, your documents and the pages produced from them. You give us permission to process them only as far as needed to provide the service to you.',
          'You confirm that every handwriting sample you add is your own handwriting, and that you have the right to use the documents you upload.',
        ],
      },
      {
        heading: 'Acceptable use',
        paragraphs: [
          'You must follow the acceptable use policy. In short: only your own handwriting, no forgery, no fraud, and no use where work must be written by hand by you.',
        ],
      },
      {
        heading: 'Plans, pages and payment',
        bullets: [
          'One credit is one exported page. Previews are free.',
          'Pages included in a plan reset each month and do not carry over. Top-up and bonus pages do not expire.',
          'Paid plans renew automatically until cancelled. You can cancel at any time and keep the plan until the end of the period already paid for.',
          'Payments are handled by our payment provider, which acts as the seller of record. Prices are shown before you pay.',
          'Refunds are described in the refund policy.',
        ],
      },
      {
        heading: 'No guarantee about how the output is judged',
        paragraphs: [
          'We do not promise that pages produced by the service cannot be told apart from writing done by hand, or that they will be accepted by any school, employer or other body. How you use them is your responsibility.',
        ],
      },
      {
        heading: 'Availability and changes',
        paragraphs: [
          'We work to keep the service running but do not guarantee it will always be available or free of errors. We may change or withdraw features. If we change these terms in a way that matters, we will tell you before the change takes effect.',
        ],
      },
      {
        heading: 'Ending your use',
        paragraphs: [
          'You can stop using the service and delete your data at any time. We may suspend or close an account that breaks these terms or the acceptable use policy.',
        ],
      },
      {
        heading: 'Contact',
        paragraphs: [`Questions about these terms: ${SUPPORT_EMAIL}.`],
      },
    ],
  },
  {
    slug: 'privacy',
    name: 'Privacy',
    title: 'Privacy policy',
    description: `What ${name} does with your handwriting sample, your documents and your account details, and how to delete them.`,
    sections: [
      {
        heading: 'The short version',
        bullets: [
          'The photo of your handwriting is processed on your own device and is not uploaded.',
          'Your handwriting is used only to write your own documents. It is never shared with other users and never used to imitate you.',
          'The text of your documents is sent to our server only when you export, and is not kept afterwards.',
          'We do not sell personal data.',
        ],
      },
      {
        heading: 'Your handwriting',
        paragraphs: [
          'When you add a handwriting sample, the photo is turned into letter shapes in your browser. The photo itself is not sent to us.',
          'The letter shapes are stored in your browser. When you export a document they are sent to our server together with the text, so that the pages can be written. If you save a handwriting profile to your account, it is stored encrypted on our servers until you delete it.',
        ],
      },
      {
        heading: 'Your documents',
        paragraphs: [
          'Files you upload are read in your browser. The text is sent to our server only when you export. The finished PDF is kept for up to 24 hours so that you can download it, then deleted.',
          'We do not read your documents, and their content is not written to logs or analytics.',
        ],
      },
      {
        heading: 'Account and payment details',
        paragraphs: [
          'If you create an account we store your email address, your plan, and a record of pages granted and used. Card details are handled by our payment provider and never reach our servers.',
          'To limit abuse of the free plan we store a scrambled (hashed) form of the network address and device used when an account is first activated. The original values are not kept.',
        ],
      },
      {
        heading: 'Usage statistics',
        paragraphs: [
          'We count a small number of events, such as "demo used" or "export completed", with a few fixed properties like the plan or a range of page counts. These never include text you typed, file names, or anything from your documents.',
        ],
      },
      {
        heading: 'Deleting your data',
        paragraphs: [
          `You can delete your handwriting from your device on the "My handwriting" page at any time. To delete your account and everything stored with it, write to ${SUPPORT_EMAIL}.`,
        ],
      },
      {
        heading: 'Contact',
        paragraphs: [`Questions or requests about your data: ${SUPPORT_EMAIL}.`],
      },
    ],
  },
  {
    slug: 'refunds',
    name: 'Refunds',
    title: 'Refund policy',
    description: `${name} refunds any payment on request within 7 days. How to ask, and what happens to your plan and pages.`,
    sections: [
      {
        heading: '7-day refund',
        paragraphs: [
          `If you are not satisfied, ask for a refund within 7 days of a payment and we will return it. Write to ${SUPPORT_EMAIL} from the email address of your account.`,
        ],
      },
      {
        heading: 'What happens next',
        bullets: [
          'A refunded subscription payment ends the paid plan; your account returns to the free plan.',
          'A refunded top-up removes the pages from that top-up that have not been used.',
          'Refunds go back to the original payment method. How long that takes depends on your bank.',
        ],
      },
      {
        heading: 'Failed exports',
        paragraphs: [
          'You are never charged pages for an export that fails. If you believe pages were taken wrongly, tell us and we will put it right.',
        ],
      },
      {
        heading: 'After 7 days',
        paragraphs: [
          'You can cancel at any time, and keep your plan until the end of the period you have paid for. Payments older than 7 days are not normally refunded, but write to us if something went wrong.',
        ],
      },
    ],
  },
  {
    slug: 'acceptable-use',
    name: 'Acceptable use',
    title: 'Acceptable use policy',
    description: `What ${name} may not be used for: imitating other people's handwriting, forged or fraudulent documents, and work that must be handwritten by you.`,
    sections: [
      {
        heading: 'Your own handwriting only',
        paragraphs: [
          'Every handwriting sample you add must be your own handwriting. You are asked to confirm this each time. Do not add, or try to reproduce, anyone else\u2019s handwriting, with or without their knowledge.',
        ],
      },
      {
        heading: 'What is not allowed',
        bullets: [
          'Forging signatures, or producing anything meant to pass as signed or written by another person.',
          'Forged or fraudulent documents of any kind: letters, notes from parents or doctors, references, forms, certificates, legal or financial papers.',
          'Presenting generated pages as written by hand by you where that is required, for example a handwritten exam, a handwritten assignment, or a declaration that must be in your own hand.',
          'Breaking the rules of your school, university, employer or any other body you answer to.',
          'Creating many accounts to get around plan limits, or interfering with the service.',
        ],
      },
      {
        heading: 'What it is for',
        paragraphs: [
          'Notes, summaries, letters, cards, journals, display work and anything else where you want your own typed words in your own handwriting, and are free to produce it that way.',
        ],
      },
      {
        heading: 'What we do about misuse',
        paragraphs: [
          `We may suspend or close accounts that break this policy, and cooperate with lawful requests about fraud or forgery. To report misuse, write to ${SUPPORT_EMAIL}.`,
        ],
      },
    ],
  },
];
