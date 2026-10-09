'use client';

import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/sample', label: 'My handwriting' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/faq', label: 'FAQ' },
  { href: '/account', label: 'Account' },
];

/** The main links, with the page you are on marked for the eye and for screen readers. */
export function NavLinks() {
  const path = usePathname();
  const current = (href: string): 'page' | undefined =>
    path === href || path.startsWith(`${href}/`) ? 'page' : undefined;
  return (
    <nav aria-label="Main">
      {LINKS.map((link) => (
        <a key={link.href} href={link.href} aria-current={current(link.href)}>
          {link.label}
        </a>
      ))}
      <a className="nav-cta" href="/editor" aria-current={current('/editor')}>
        Open editor
      </a>
    </nav>
  );
}
