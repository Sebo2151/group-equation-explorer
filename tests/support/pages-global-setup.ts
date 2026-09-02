import { startPagesServer, stopPagesServer } from './serve-pages.ts';

/** Serve the production export for the comprehensive browser suite. */
export default async function setupPagesPreview() {
  const server = await startPagesServer();
  return async () => stopPagesServer(server);
}
