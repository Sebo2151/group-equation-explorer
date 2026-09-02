/**
 * Tailwind's entry point, which `app/globals.css` imports.
 *
 * This configuration used to live in `vite.config.ts`. It moved here when the
 * build became a plain Next.js static export, because that is where Next looks
 * for it.
 */
const config = {
  plugins: { '@tailwindcss/postcss': {} },
};

export default config;
