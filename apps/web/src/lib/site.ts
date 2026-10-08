import { BRAND } from '@pentwin/shared';
import type { Metadata } from 'next';

/** Where the site lives. Set NEXT_PUBLIC_SITE_URL in production; no trailing slash. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(
  /\/$/,
  '',
);

/**
 * PLACEHOLDER: there is no support address yet. Shown on the legal and FAQ pages, so it
 * must be replaced with a real one before launch.
 */
export const SUPPORT_EMAIL = 'support@example.com';

export const absoluteUrl = (path: string): string => `${SITE_URL}${path === '/' ? '' : path}`;

/** Search engines cut titles at about 60 characters and descriptions at about 155. */
export const TITLE_LIMIT = 60;
export const DESCRIPTION_LIMIT = 155;

export interface PageInfo {
  /** The page's own title, without the site name. */
  title: string;
  description: string;
  path: string;
}

/** The full `<title>` of a page: its own title, then the site name if there is room. */
export const fullTitle = (title: string): string => {
  const withBrand = `${title} | ${BRAND.name}`;
  return withBrand.length <= TITLE_LIMIT ? withBrand : title;
};

/** Title, description, canonical address and social cards for one page. */
export function pageMetadata({ title, description, path }: PageInfo): Metadata {
  const url = absoluteUrl(path);
  return {
    title: { absolute: fullTitle(title) },
    description,
    alternates: { canonical: url },
    openGraph: {
      title: fullTitle(title),
      description,
      url,
      siteName: BRAND.name,
      type: 'website',
      images: [
        {
          url: absoluteUrl('/og.png'),
          width: 1200,
          height: 630,
          alt: `${BRAND.name}: ${BRAND.tagline}`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle(title),
      description,
      images: [absoluteUrl('/og.png')],
    },
  };
}

/** Breadcrumb structured data for a page below the home page. */
export const breadcrumbs = (trail: { name: string; path: string }[]) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [{ name: 'Home', path: '/' }, ...trail].map((item, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: item.name,
    item: absoluteUrl(item.path),
  })),
});
