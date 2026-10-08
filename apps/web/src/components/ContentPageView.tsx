import { BRAND } from '@pentwin/shared';
import type { ContentPage } from '../lib/pages';
import { breadcrumbs } from '../lib/site';
import { Faq } from './Faq';
import { Gallery } from './Gallery';
import { JsonLd } from './JsonLd';
import { LiveDemo } from './LiveDemo';

/** Renders one tool or audience landing page from its content. */
export function ContentPageView({ page }: { page: ContentPage }) {
  return (
    <article>
      <header className="section" style={{ paddingBottom: '0.5rem' }}>
        <h1 className="display">{page.heading}</h1>
        <p className="lead">{page.lead}</p>
      </header>

      {page.demo && (
        <section className="section" style={{ paddingTop: '0.5rem' }}>
          <LiveDemo source="tool" />
        </section>
      )}

      <div className="section prose" style={{ paddingTop: '0.5rem' }}>
        {page.sections.map((section) => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            {section.paragraphs?.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {section.steps && (
              <ol>
                {section.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            )}
            {section.bullets && (
              <ul>
                {section.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
        <p>
          <a className="button primary" href={page.cta.href}>
            {page.cta.label}
          </a>
        </p>
      </div>

      {page.gallery && (
        <section className="section">
          <h2>What the result looks like</h2>
          <p className="muted">Unedited output in the sample handwriting.</p>
          <Gallery only={page.gallery} />
        </section>
      )}

      <section className="section narrow">
        <h2>Questions</h2>
        <Faq items={page.faq} structured />
        <p className="muted">
          More in the <a href="/faq">{BRAND.name} FAQ</a> and on the{' '}
          <a href="/pricing">pricing page</a>.
        </p>
      </section>

      <JsonLd data={breadcrumbs([{ name: page.name, path: page.path }])} />
    </article>
  );
}
