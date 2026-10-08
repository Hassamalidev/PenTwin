import { notFound } from 'next/navigation';
import { ContentPageView } from '../../../components/ContentPageView';
import { AUDIENCE_PAGES } from '../../../lib/pages';
import { pageMetadata } from '../../../lib/site';

const find = (slug: string) => AUDIENCE_PAGES.find((page) => page.path === `/for/${slug}`);

export const dynamicParams = false;
export const generateStaticParams = () =>
  AUDIENCE_PAGES.map((page) => ({ slug: page.path.split('/').pop()! }));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const page = find((await params).slug);
  return page ? pageMetadata(page) : {};
}

export default async function AudiencePage({ params }: { params: Promise<{ slug: string }> }) {
  const page = find((await params).slug);
  if (!page) notFound();
  return <ContentPageView page={page} />;
}
