import type { ReactNode } from 'react';
import { pageMetadata } from '../../lib/site';

export const metadata = {
  ...pageMetadata({
    title: 'Sign in',
    description: 'Sign in or create an account to export in your own handwriting.',
    path: '/signin',
  }),
  // An app screen: nothing here for a search engine.
  robots: { index: false, follow: false },
};

export default function SignInLayout({ children }: { children: ReactNode }) {
  return children;
}
