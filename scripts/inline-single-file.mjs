// Post-build step: Angular's esbuild-based builder still emits separate
// main.js / styles.css / favicon.ico files next to index.html. This inlines
// all of them into one self-contained index.html per the project's
// single-file-build requirement.
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const browserDir = join(dirname(new URL(import.meta.url).pathname), '..', 'dist', 'json-canopy', 'browser');
const indexPath = join(browserDir, 'index.html');

let html = readFileSync(indexPath, 'utf8');
const consumedFiles = [];

// Inline <script src="...">.
html = html.replace(/<script([^>]*?)\ssrc="([^"]+)"([^>]*)><\/script>/g, (match, before, src, after) => {
  if (/^https?:|^\/\//.test(src)) return match;
  const filePath = join(browserDir, src);
  const content = readFileSync(filePath, 'utf8');
  consumedFiles.push(filePath);
  return `<script${before}${after}>\n${content}\n</script>`;
});

// Inline <link rel="stylesheet" href="..."> and drop its <noscript> fallback.
html = html.replace(
  /<link rel="stylesheet" href="([^"]+)"[^>]*>(\s*<noscript><link rel="stylesheet" href="\1"><\/noscript>)?/g,
  (match, href) => {
    if (/^https?:|^\/\//.test(href)) return match;
    const filePath = join(browserDir, href);
    const content = readFileSync(filePath, 'utf8');
    consumedFiles.push(filePath);
    return `<style>\n${content}\n</style>`;
  },
);

// Inline the favicon as a data URI.
html = html.replace(/<link rel="icon" type="([^"]+)" href="([^"]+)">/, (match, type, href) => {
  if (/^https?:|^\/\/|^data:/.test(href)) return match;
  const filePath = join(browserDir, href);
  if (!existsSync(filePath)) return match;
  const b64 = readFileSync(filePath).toString('base64');
  consumedFiles.push(filePath);
  return `<link rel="icon" type="${type}" href="data:${type};base64,${b64}">`;
});

html = html.replace(/\sdata-beasties-container/, '');

writeFileSync(indexPath, html);

for (const file of new Set(consumedFiles)) {
  unlinkSync(file);
}

console.log(`Inlined ${consumedFiles.length} file(s) into ${indexPath}`);
