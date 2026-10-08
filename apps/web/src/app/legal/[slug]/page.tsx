import { notFound } from 'next/navigation';
import { JsonLd } from '../../../components/JsonLd';
import { LEGAL_PAGES, LEGAL_UPDATED } from '../../../lib/legal';
import { breadcrumbs, pageMetadata } from '../../../lib/site';

const find = (slug: string) => LEGAL_PAGES.find((page) => page.slug === slug);

export const dynamicParams = false;
export const generateStaticParams = () => LEGAL_PAGES.map((page) => ({ slug: page.slug }));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const page = find((await params).slug);
  return page
    ? pageMetadata({
        title: page.title,
        description: page.description,
        path: `/legal/${page.slug}`,
      })
    : {};
}

export default async function LegalRoute({ params }: { params: Promise<{ slug: string }> }) {
  const page = find((await params).slug);
  if (!page) notFound();
  return (
    <article className="section narrow prose">
      <h1>{page.title}</h1>
      <p className="muted">Last updated {LEGAL_UPDATED}.</p>
      <p className="notice" data-testid="legal-draft">
        This is a draft and has not yet been reviewed by a lawyer.
      </p>
      {page.sections.map((section) => (
        <section key={section.heading}>
          <h2>{section.heading}</h2>
          {section.paragraphs?.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          {section.bullets && (
            <ul>
              {section.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
      <JsonLd data={breadcrumbs([{ name: page.name, path: `/legal/${page.slug}` }])} />
    </article>
  );
}
