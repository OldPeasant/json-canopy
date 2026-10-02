// Copies what this extension ships but doesn't own into it: the single-file
// web app built by the Angular project one directory up (`npm run build`
// there), which CanopyEditor reads at runtime — the counterpart of the
// IntelliJ plugin's copyWebApp task — and the project's LICENSE and NOTICE,
// which the package must carry.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootDir = join(extensionDir, '..');
const webApp = join(rootDir, 'dist', 'json-canopy', 'browser', 'index.html');

if (!existsSync(webApp)) {
  console.error(`Missing ${webApp} — run \`npm run build\` in the Angular project first (or \`npm run build\` here).`);
  process.exit(1);
}
mkdirSync(join(extensionDir, 'webview'), { recursive: true });
copyFileSync(webApp, join(extensionDir, 'webview', 'index.html'));
for (const file of ['LICENSE', 'NOTICE']) copyFileSync(join(rootDir, file), join(extensionDir, file));
console.log(`Copied the web app, LICENSE and NOTICE into ${extensionDir}`);
