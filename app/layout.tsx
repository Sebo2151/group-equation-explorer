import type { Metadata } from 'next';
import 'katex/dist/katex.min.css';
import './globals.css';

/**
 * Social-card image URLs must be absolute, and are resolved against this. Without
 * it a shared link advertises an image on whatever host built the site.
 */
const SITE_URL = new URL('https://sebo2151.github.io/group-equation-explorer/');

/**
 * Capture the fragment before the App Router hydrates. A router restore uses
 * replaceState, which emits no hashchange event, so code loaded afterward
 * cannot otherwise recover a challenge or proof fragment that it overwrote.
 */
const CAPTURE_ARRIVAL = `
(() => {
  const record = () => {
    const fragment = window.location.hash;
    if (
      fragment ||
      window.__groupEquationExplorerArrivalReady ||
      window.__groupEquationExplorerArrival === undefined
    ) {
      window.__groupEquationExplorerArrival = fragment;
    }
  };
  record();
  window.addEventListener('hashchange', record);
})();`;

export const metadata: Metadata = {
  metadataBase: SITE_URL,
  title: 'Group Equation Explorer',
  description: 'Rewrite expressions and solve equations using only the group laws.',
  openGraph: {
    title: 'Group Equation Explorer',
    description: 'Rewrite expressions and solve equations using only the group laws.',
    type: 'website',
    images: [{ url: '/og.png', alt: 'Group Equation Explorer' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Group Equation Explorer',
    description: 'Rewrite expressions and solve equations using only the group laws.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <script id="capture-arrival" dangerouslySetInnerHTML={{ __html: CAPTURE_ARRIVAL }} />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
