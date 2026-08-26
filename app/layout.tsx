import type { Metadata } from 'next';
import 'katex/dist/katex.min.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Group Equation Explorer',
  description: 'Build justified chains of equivalent group expressions, one axiom at a time.',
  openGraph: {
    title: 'Group Equation Explorer',
    description: 'One move. One reason. One proof.',
    type: 'website',
    images: [{ url: '/og.png', alt: 'Group Equation Explorer — One move. One reason. One proof.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Group Equation Explorer',
    description: 'One move. One reason. One proof.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
