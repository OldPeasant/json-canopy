// Copies the single-file web app built by the Angular project one directory
// up (`npm run build` there) into this extension, where CanopyEditor reads
// it at runtime. The counterpart of the IntelliJ plugin's copyWebApp task.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(extensionDir, '..', 'dist', 'json-canopy', 'browser', 'index.html');
const targetDir = join(extensionDir, 'webview');

if (!existsSync(source)) {
  console.error(`Missing ${source} — run \`npm run build\` in the Angular project first (or \`npm run build\` here).`);
  process.exit(1);
}
mkdirSync(targetDir, { recursive: true });
copyFileSync(source, join(targetDir, 'index.html'));
console.log(`Copied ${source} -> ${targetDir}/index.html`);
