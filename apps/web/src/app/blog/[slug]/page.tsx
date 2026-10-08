import { BRAND } from '@pentwin/shared';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { JsonLd } from '../../../components/JsonLd';
import { POSTS } from '../../../lib/posts';
import { absoluteUrl, breadcrumbs, pageMetadata } from '../../../lib/site';

const find = (slug: string) => POSTS.find((post) => post.slug === slug);

export const dynamicParams = false;
export const generateStaticParams = () => POSTS.map((post) => ({ slug: post.slug }));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const post = find((await params).slug);
  return post
    ? pageMetadata({ title: post.title, description: post.description, path: `/blog/${post.slug}` })
    : {};
}

/** Turns "[text](/path)" into links; everything else stays plain text. */
function withLinks(text: string): ReactNode[] {
  return text.split(/(\[[^\]]+\]\([^)]+\))/).map((part, index) => {
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    return link ? (
      <a key={index} href={link[2]}>
        {link[1]}
      </a>
    ) : (
      part
    );
  });
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const post = find((await params).slug);
  if (!post) notFound();

  const article = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description,
    datePublished: post.published,
    dateModified: post.published,
    author: { '@type': 'Organization', name: BRAND.name },
    publisher: { '@type': 'Organization', name: BRAND.name },
    mainEntityOfPage: absoluteUrl(`/blog/${post.slug}`),
    image: absoluteUrl('/og.png'),
  };

  return (
    <article className="section narrow prose">
      <p className="muted">
        <a href="/blog">Blog</a>
      </p>
      <h1>{post.title}</h1>
      {post.body.map((block, index) =>
        'h' in block ? (
          <h2 key={index}>{block.h}</h2>
        ) : 'p' in block ? (
          <p key={index}>{withLinks(block.p)}</p>
        ) : (
          <ul key={index}>
            {block.list.map((item) => (
              <li key={item}>{withLinks(item)}</li>
            ))}
          </ul>
        ),
      )}
      <p>
        <a className="button primary" href="/tools/text-to-handwriting">
          Try the free text to handwriting tool
        </a>
      </p>
      <JsonLd data={article} />
      <JsonLd
        data={breadcrumbs([
          { name: 'Blog', path: '/blog' },
          { name: post.title, path: `/blog/${post.slug}` },
        ])}
      />
    </article>
  );
}
