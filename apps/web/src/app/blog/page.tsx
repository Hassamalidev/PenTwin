import { BRAND } from '@pentwin/shared';
import { JsonLd } from '../../components/JsonLd';
import { POSTS } from '../../lib/posts';
import { breadcrumbs, pageMetadata } from '../../lib/site';

export const metadata = pageMetadata({
  title: 'Blog: handwriting, paper and how it works',
  description: `Articles from ${BRAND.name} on making typed text look handwritten, choosing paper, and how generated handwriting works.`,
  path: '/blog',
});

export default function BlogIndex() {
  return (
    <div className="section narrow">
      <h1 className="display">Blog</h1>
      <div className="grid" style={{ gridTemplateColumns: '1fr' }}>
        {POSTS.map((post) => (
          <article className="card" key={post.slug}>
            <h2>
              <a href={`/blog/${post.slug}`}>{post.title}</a>
            </h2>
            <p className="muted" style={{ margin: 0 }}>
              {post.description}
            </p>
          </article>
        ))}
      </div>
      <JsonLd data={breadcrumbs([{ name: 'Blog', path: '/blog' }])} />
    </div>
  );
}
