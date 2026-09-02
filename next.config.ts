import type { NextConfig } from 'next';

/**
 * The app ships as a static site on GitHub Pages.
 *
 * Every page is prerendered at build time and every interaction after that is
 * client-side: the mathematics, the proof history, and the stored progress all
 * live in the browser, and nothing here needs a server to answer a request. So
 * `output: 'export'` is not a limitation being worked around; it is an accurate
 * description of what this app is.
 */

/**
 * GitHub Pages serves a project repository from a subdirectory, so the built
 * site must know its own prefix. Keep this in step with the repository name.
 * Moving to a custom domain served at a root path means emptying it.
 *
 * It applies to production builds only. The development server and the
 * Playwright suite address the app at the origin root, and a prefix there would
 * mean every `page.goto('/')` in the tests had to carry it. The prefixed output
 * is verified directly instead, by serving `out/` under that path.
 */
const BASE_PATH = process.env.NODE_ENV === 'production' ? '/group-equation-explorer' : '';

const nextConfig: NextConfig = {
  output: 'export',
  basePath: BASE_PATH,
  assetPrefix: BASE_PATH,
  // Pages has no image optimization server, so images are served as authored.
  images: { unoptimized: true },
};

export default nextConfig;
