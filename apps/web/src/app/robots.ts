import type { MetadataRoute } from 'next';
import { absoluteUrl } from '../lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // The app itself and internal pages have nothing for a search engine.
        disallow: ['/editor', '/sample', '/admin', '/style'],
      },
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
