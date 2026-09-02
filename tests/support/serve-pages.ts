import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve('out');
const sitePath = '/group-equation-explorer';
const host = '127.0.0.1';

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.ttf', 'font/ttf'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

export function startPagesServer(port = Number(process.env.PORT ?? 3000)): Promise<Server> {
  const server = createServer(async (request, response) => {
    const send = (status: number, body: string, headers = {}) => {
      response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...headers });
      response.end(body);
    };

    if (!request.url) return send(400, 'Bad request');

    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url, `http://${host}:${port}`).pathname);
    } catch {
      return send(400, 'Bad request');
    }

    if (pathname === sitePath) {
      response.writeHead(308, { location: `${sitePath}/` });
      return response.end();
    }

    // The exact mount exercises deployment. The root alias lets the established
    // browser suite keep its route-independent `/#fragment` URLs while loading
    // the same prefixed production assets.
    const relative =
      pathname === '/'
        ? 'index.html'
        : pathname.startsWith(`${sitePath}/`)
          ? pathname.slice(sitePath.length + 1) || 'index.html'
          : null;
    if (relative === null) return send(404, 'Not found');

    const file = resolve(root, relative);
    if (file !== root && !file.startsWith(`${root}${sep}`)) return send(404, 'Not found');

    let details;
    try {
      details = await stat(file);
      if (!details.isFile()) return send(404, 'Not found');
    } catch {
      return send(404, 'Not found');
    }

    response.writeHead(200, {
      'content-length': String(details.size),
      'content-type': contentTypes.get(extname(file)) ?? 'application/octet-stream',
    });
    createReadStream(file).pipe(response);
  });

  return new Promise((resolveListening, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolveListening(server);
    });
  });
}

export function stopPagesServer(server: Server): Promise<void> {
  return new Promise((resolveClosed, reject) => {
    server.close((error) => (error ? reject(error) : resolveClosed()));
    server.closeAllConnections();
  });
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const server = await startPagesServer();
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 3000;
  console.log(`GitHub Pages preview: http://${host}:${port}${sitePath}/`);

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      await stopPagesServer(server);
    });
  }
}
