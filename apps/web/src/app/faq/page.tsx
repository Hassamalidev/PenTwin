import { BRAND } from '@pentwin/shared';
import { Faq } from '../../components/Faq';
import { JsonLd } from '../../components/JsonLd';
import { CREDIT_FAQ, faqJsonLd, GENERAL_FAQ } from '../../lib/faq';
import { breadcrumbs, pageMetadata, SUPPORT_EMAIL } from '../../lib/site';

export const metadata = pageMetadata({
  title: 'Questions and answers',
  description: `How ${BRAND.name} works, which files it reads, what happens to your handwriting, refunds, and what it must not be used for.`,
  path: '/faq',
});

export default function FaqPage() {
  return (
    <div className="section narrow">
      <h1 className="display">Questions and answers</h1>
      <h2>Using {BRAND.name}</h2>
      <Faq items={GENERAL_FAQ} />
      <h2 style={{ marginTop: '2rem' }}>Pages and payment</h2>
      <Faq items={CREDIT_FAQ} />
      <p className="muted" style={{ marginTop: '1.5rem' }}>
        Something else? Write to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
      {/* One FAQPage for the whole page, as search engines expect. */}
      <JsonLd data={faqJsonLd([...GENERAL_FAQ, ...CREDIT_FAQ])} />
      <JsonLd data={breadcrumbs([{ name: 'FAQ', path: '/faq' }])} />
    </div>
  );
}
