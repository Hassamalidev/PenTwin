import { faqJsonLd, type FaqItem } from '../lib/faq';
import { JsonLd } from './JsonLd';

/** A list of questions that open on tap. `structured` also publishes them to search engines. */
export function Faq({ items, structured = false }: { items: FaqItem[]; structured?: boolean }) {
  return (
    <div className="faq">
      {items.map((item) => (
        <details key={item.question}>
          <summary>{item.question}</summary>
          <p>{item.answer}</p>
        </details>
      ))}
      {structured && <JsonLd data={faqJsonLd(items)} />}
    </div>
  );
}
