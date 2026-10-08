import { BRAND, PLANS } from '@pentwin/shared';
import { Faq } from '../../components/Faq';
import { JsonLd } from '../../components/JsonLd';
import { PricingCards } from '../../components/PricingCards';
import { CREDIT_FAQ } from '../../lib/faq';
import { absoluteUrl, breadcrumbs, pageMetadata } from '../../lib/site';

export const metadata = pageMetadata({
  title: 'Pricing: free, Student and Pro plans',
  description: `Start free with ${PLANS.free.monthlyPages} pages a month. Student: ${PLANS.student.monthlyPages} pages for $${PLANS.student.price.month}. Pro: ${PLANS.pro.monthlyPages} pages for $${PLANS.pro.price.month}. 1 credit = 1 page; previews are free.`,
  path: '/pricing',
});

const offers = {
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: BRAND.name,
  description: 'Writes your documents in your own handwriting.',
  offers: (['free', 'student', 'pro'] as const).map((id) => ({
    '@type': 'Offer',
    name: `${PLANS[id].name} plan`,
    price: PLANS[id].price.month.toFixed(2),
    priceCurrency: 'USD',
    url: absoluteUrl('/pricing'),
    availability: 'https://schema.org/InStock',
  })),
};

export default function PricingPage() {
  return (
    <>
      <header className="section" style={{ paddingBottom: '0.5rem' }}>
        <h1 className="display">Pricing</h1>
        <p className="lead">
          One credit is one exported page. Previews are free, so you only pay for pages you keep.
        </p>
      </header>
      <section className="section" style={{ paddingTop: '0.5rem' }}>
        <PricingCards />
      </section>
      <section className="section narrow">
        <h2>How credits work</h2>
        <Faq items={CREDIT_FAQ} structured />
        <p className="muted">
          Not satisfied? Ask within 7 days of a payment and it is refunded. See the{' '}
          <a href="/legal/refunds">refund policy</a>.
        </p>
      </section>
      <JsonLd data={offers} />
      <JsonLd data={breadcrumbs([{ name: 'Pricing', path: '/pricing' }])} />
    </>
  );
}
