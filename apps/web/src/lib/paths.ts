import { LEGAL_PAGES } from './legal';
import { CONTENT_PAGES } from './pages';
import { POSTS } from './posts';

/** Every public page. The app screens (editor, handwriting, admin) are left out on purpose. */
export const PUBLIC_PATHS: string[] = [
  '/',
  '/pricing',
  '/faq',
  ...CONTENT_PAGES.map((page) => page.path),
  '/blog',
  ...POSTS.map((post) => `/blog/${post.slug}`),
  ...LEGAL_PAGES.map((page) => `/legal/${page.slug}`),
];
