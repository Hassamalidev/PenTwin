import { BRAND, PLANS } from '@pentwin/shared';
import { CompareSlider } from '../components/CompareSlider';
import { Faq } from '../components/Faq';
import { Gallery } from '../components/Gallery';
import { JsonLd } from '../components/JsonLd';
import { LiveDemo } from '../components/LiveDemo';
import { GENERAL_FAQ } from '../lib/faq';
import { absoluteUrl, pageMetadata } from '../lib/site';

const description =
  'Write any Word or PDF document in your own handwriting. Photograph one handwritten page, upload your file, export a PDF. Free to try.';

export const metadata = pageMetadata({
  title: 'Turn any document into your own handwriting',
  description,
  path: '/',
});

const application = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: BRAND.name,
  applicationCategory: 'UtilitiesApplication',
  operatingSystem: 'Any (web browser)',
  description,
  url: absoluteUrl('/'),
  offers: (['free', 'student', 'pro'] as const).map((id) => ({
    '@type': 'Offer',
    name: PLANS[id].name,
    price: PLANS[id].price.month.toFixed(2),
    priceCurrency: 'USD',
    url: absoluteUrl('/pricing'),
  })),
};

const REASONS = [
  {
    title: 'No two letters alike',
    text: 'Every letter is picked from several you wrote, never the same one twice in a row, then bent slightly so even those do not repeat.',
  },
  {
    title: 'The line wanders',
    text: 'Real writing drifts above and below the line and tilts a little. Here it drifts smoothly, the way a hand does, not at random.',
  },
  {
    title: 'Real pens',
    text: 'Ballpoint, gel, fountain pen and pencil each lay down ink differently: darker and lighter, wider and thinner.',
  },
  {
    title: 'On real paper',
    text: 'Lined, squared, dotted or plain. On lined paper the writing sits on the lines, a little unevenly, the way it does when you write.',
  },
];

const STEPS = [
  {
    title: 'Write one page',
    text: 'Copy a short text by hand on plain paper, in your normal writing, and take a photo with your phone.',
  },
  {
    title: 'Upload your document',
    text: 'A Word file, a PDF, or pasted text. From Word files, headings, lists and tables are kept.',
  },
  {
    title: 'Check and export',
    text: 'The preview is free and updates as you change things. Export a PDF when it looks right.',
  },
];

export default function Home() {
  return (
    <>
      <section className="hero">
        <div>
          <h1 className="display">
            Turn any document into <em>your own</em> handwriting.
          </h1>
          <p className="lead">
            Write one page by hand and photograph it. {BRAND.name} learns your letters, then writes
            your Word and PDF documents the way you would.
          </p>
          <div className="row">
            <a className="button primary large" href="#demo">
              Try it now, no sign-up
            </a>
            <a className="button large" href="/sample">
              Add my handwriting
            </a>
          </div>
          <ul className="ticks">
            <li>Free to try</li>
            <li>Your photo stays on your device</li>
            <li>Word, PDF or pasted text</li>
          </ul>
        </div>
        <CompareSlider />
      </section>

      <section className="section" id="demo">
        <div className="section-head">
          <h2 className="display">Try it</h2>
          <p className="muted">Type anything. It is written out as you go.</p>
        </div>
        <LiveDemo source="home" />
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="display">How it works</h2>
        </div>
        <div className="grid">
          {STEPS.map((step, index) => (
            <div className="card feature" key={step.title}>
              <span className="feature-mark" aria-hidden="true">
                {index + 1}
              </span>
              <h3>
                {index + 1}. {step.title}
              </h3>
              <p className="muted">{step.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="display">Why it looks handwritten</h2>
          <p className="muted">
            A handwriting font repeats one shape for every letter on a ruler-straight line. Real
            writing does neither.
          </p>
        </div>
        <div className="grid">
          {REASONS.map((reason) => (
            <div className="card feature" key={reason.title}>
              <h3>{reason.title}</h3>
              <p className="muted">{reason.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="display">Examples</h2>
          <p className="muted">
            Unedited output, written with our sample handwriting. Yours will look like you.
          </p>
        </div>
        <Gallery />
      </section>

      <section className="section narrow">
        <div className="section-head">
          <h2 className="display">Questions</h2>
        </div>
        <Faq items={GENERAL_FAQ.slice(0, 5)} />
        <p>
          <a href="/faq">All questions</a> · <a href="/pricing">Pricing</a>
        </p>
      </section>

      <section className="cta-band">
        <h2 className="display">See a page in your own handwriting.</h2>
        <p>
          It takes one handwritten page and a photo. The preview is free, and you only use pages
          when you export.
        </p>
        <div className="row">
          <a className="button large" href="/sample">
            Add my handwriting
          </a>
          <a className="button ghost large" href="/editor">
            Open the editor
          </a>
        </div>
      </section>

      <JsonLd data={application} />
    </>
  );
}
