// Copies what this extension ships but doesn't own into it: the single-file
// web app built by the Angular project one directory up (`npm run build`
// there), which CanopyEditor reads at runtime — the counterpart of the
// IntelliJ plugin's copyWebApp task — and the project's LICENSE, NOTICE and
// CHANGELOG.md (the Marketplace's Changelog tab).
//
// Also the version check: the root package.json holds the version the
// IntelliJ plugin and this extension share (Gradle reads it from there), but
// vsce only reads this directory's package.json, so the two must agree.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootDir = join(extensionDir, '..');
const webApp = join(rootDir, 'dist', 'json-canopy', 'browser', 'index.html');

const versionOf = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
if (versionOf(extensionDir) !== versionOf(rootDir)) {
  console.error(
    `Version mismatch: vscode-extension/package.json has ${versionOf(extensionDir)}, the root package.json ${versionOf(rootDir)}.\n` +
      'Set both, e.g. `npm version X.Y.Z --no-git-tag-version` in the root and in vscode-extension/.',
  );
  process.exit(1);
}

if (!existsSync(webApp)) {
  console.error(`Missing ${webApp} — run \`npm run build\` in the Angular project first (or \`npm run build\` here).`);
  process.exit(1);
}
mkdirSync(join(extensionDir, 'webview'), { recursive: true });
copyFileSync(webApp, join(extensionDir, 'webview', 'index.html'));
for (const file of ['LICENSE', 'NOTICE', 'CHANGELOG.md']) copyFileSync(join(rootDir, file), join(extensionDir, file));
console.log(`Version ${versionOf(rootDir)}: copied the web app, LICENSE, NOTICE and CHANGELOG.md into ${extensionDir}`);
