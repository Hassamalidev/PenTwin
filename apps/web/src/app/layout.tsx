import { BRAND } from '@pentwin/shared';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: BRAND.name,
  description: 'Turn any document into your own handwriting.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <a className="brand" href="/">
            {BRAND.name}
          </a>
          <nav>
            <a href="/sample">My handwriting</a>
            <a href="/editor">Editor</a>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
