import { BRAND } from '@pentwin/shared';
import type { Metadata, Viewport } from 'next';
import { Caveat } from 'next/font/google';
import Script from 'next/script';
import type { ReactNode } from 'react';
import { JsonLd } from '../components/JsonLd';
import { absoluteUrl, SITE_URL } from '../lib/site';
import './globals.css';

// The handwriting-style face, used for display headings only. Only the Latin letters
// and the two weights in use are downloaded.
const hand = Caveat({
  subsets: ['latin'],
  weight: ['700'],
  variable: '--font-hand',
  display: 'swap',
});

const PLAUSIBLE_DOMAIN = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: BRAND.name,
  description: 'Turn any document into your own handwriting.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

const organization = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: BRAND.name,
  url: absoluteUrl('/'),
  logo: absoluteUrl('/og.png'),
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={hand.variable}>
      <body>
        <header className="site-header">
          <a className="brand" href="/">
            {/* The same mark as the browser tab icon. */}
            <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
              <rect width="32" height="32" rx="8" fill="#161616" />
              <path
                d="M7 22c3-1 4-9 7-9s1 8 4 8 3-10 7-11"
                fill="none"
                stroke="#ffffff"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {BRAND.name}
          </a>
          <nav aria-label="Main">
            <a href="/sample">My handwriting</a>
            <a href="/pricing">Pricing</a>
            <a href="/faq">FAQ</a>
            <a href="/account">Account</a>
            <a className="nav-cta" href="/editor">
              Open editor
            </a>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          <div className="inner">
            <div>
              <p className="footer-brand">{BRAND.name}</p>
              <p style={{ margin: 0 }}>{BRAND.tagline}</p>
            </div>
            <nav aria-label="Tools">
              <h2>Product</h2>
              <a href="/editor">Editor</a>
              <a href="/sample">My handwriting</a>
              <a href="/pricing">Pricing</a>
              <a href="/faq">Questions</a>
              <a href="/tools/text-to-handwriting">Text to handwriting</a>
              <a href="/tools/pdf-to-handwriting">PDF to handwriting</a>
              <a href="/tools/word-to-handwriting">Word to handwriting</a>
              <a href="/for/university-students">For university students</a>
              <a href="/for/school-projects">For school projects</a>
              <a href="/blog">Blog</a>
            </nav>
            <nav aria-label="Legal">
              <h2>Legal</h2>
              <a href="/legal/terms">Terms</a>
              <a href="/legal/privacy">Privacy</a>
              <a href="/legal/refunds">Refunds</a>
              <a href="/legal/acceptable-use">Acceptable use</a>
            </nav>
            <p className="footer-note">
              {BRAND.name} is for writing in your own handwriting. Please do not use it to imitate
              anyone else&apos;s, or where work has to be written by hand by you.
            </p>
          </div>
        </footer>
        <JsonLd data={organization} />
        {PLAUSIBLE_DOMAIN && (
          <Script
            defer
            data-domain={PLAUSIBLE_DOMAIN}
            src="https://plausible.io/js/script.tagged-events.js"
            strategy="afterInteractive"
          />
        )}
      </body>
    </html>
  );
}
