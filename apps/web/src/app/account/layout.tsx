import type { ReactNode } from 'react';
import { pageMetadata } from '../../lib/site';

export const metadata = {
  ...pageMetadata({
    title: 'Your account',
    description: 'Your plan, the pages you have left, your handwriting and your data.',
    path: '/account',
  }),
  // An app screen: nothing here for a search engine.
  robots: { index: false, follow: false },
};

export default function AccountLayout({ children }: { children: ReactNode }) {
  return children;
}
