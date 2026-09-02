import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const output = resolve('out');
const capturePattern = /<script id="capture-arrival">[\s\S]*?<\/script>/;
let moved = 0;

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await visit(path);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.html')) continue;

    const html = await readFile(path, 'utf8');
    const capture = capturePattern.exec(html)?.[0];
    if (!capture) continue;

    const withoutCapture = html.replace(capturePattern, '');
    const head = withoutCapture.indexOf('<head>');
    if (head < 0) throw new Error(`No <head> found in ${path}.`);

    const insertion = head + '<head>'.length;
    const finalized =
      withoutCapture.slice(0, insertion) + capture + withoutCapture.slice(insertion);
    await writeFile(path, finalized);
    moved += 1;
  }
}

await visit(output);
if (moved === 0) throw new Error('The arrival-capture script was missing from the export.');
console.log(`Finalized ${moved} exported HTML files.`);
