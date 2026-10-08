import type { MetadataRoute } from 'next';
import { PUBLIC_PATHS } from '../lib/paths';
import { absoluteUrl } from '../lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map((path) => ({
    url: absoluteUrl(path),
    changeFrequency: path.startsWith('/legal') ? 'yearly' : 'monthly',
    priority: path === '/' ? 1 : path.startsWith('/tools') ? 0.9 : 0.6,
  }));
}
