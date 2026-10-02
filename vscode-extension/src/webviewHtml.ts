// Turns the bundled single-file web app into the page a VS Code webview
// shows: host shim, Content Security Policy and script nonces. Pure string
// work, no `vscode` import, so it is unit-tested directly.

// Runs before the Angular bundle. The page's HostBridgeService expects the
// same two globals the IntelliJ plugin provides (see CanopyFileEditor.kt's
// loadHostedHtml): a host marker, and a function that takes one JSON string.
// Messages from the extension arrive as JSON strings too and go to
// `window.__canopyHost.dispatch`, which HostBridgeService registers before
// it sends READY — so nothing is posted before someone is listening.
//
// Theme: VS Code puts the colour theme's kind on <body> as a class
// (vscode-light, vscode-dark, vscode-high-contrast, vscode-high-contrast-light)
// and changes it live. The web app's whole theme is the `data-theme`
// attribute on <html> (src/styles.css), so following that class is all a
// theme switch takes — the counterpart of the IntelliJ plugin's ThemeSync.
// High contrast maps to the nearest of light and dark.
const HOST_SHIM = `
window.__JSON_CANOPY_HOST__ = true;
(function () {
  var vscode = acquireVsCodeApi();
  window.__canopySendToHost = function (message) { vscode.postMessage(message); };
  window.addEventListener('message', function (event) {
    if (typeof event.data === 'string' && window.__canopyHost) window.__canopyHost.dispatch(event.data);
  });

  function applyTheme() {
    var classes = document.body.classList;
    var theme = classes.contains('vscode-light') || classes.contains('vscode-high-contrast-light') ? 'light'
      : classes.contains('vscode-dark') || classes.contains('vscode-high-contrast') ? 'dark'
      : null;
    if (theme) document.documentElement.setAttribute('data-theme', theme);
  }
  function followTheme() {
    applyTheme();
    new MutationObserver(applyTheme).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
  if (document.body) followTheme();
  else document.addEventListener('DOMContentLoaded', followTheme);
})();
`;

export type Theme = 'light' | 'dark';

// - script-src: only our nonced inline scripts, plus 'unsafe-eval' because
//   Ajv compiles each schema's validator with `new Function`.
// - style-src: 'unsafe-inline' without a nonce. Angular adds component
//   <style> elements and style attributes at runtime, and browsers ignore
//   'unsafe-inline' as soon as a nonce is listed.
// - img-src data: for the inlined favicon. No connect-src: the page never
//   fetches; remote schemas are downloaded by the extension.
export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' 'unsafe-eval'`,
    "style-src 'unsafe-inline'",
    'img-src data:',
    'font-src data:',
  ].join('; ');
}

// `theme` is the initial `data-theme`, written into the markup so the page
// doesn't flash in the wrong theme before the shim has seen <body>. The
// bundled page always has the literal data-theme="dark" (src/index.html).
export function buildWebviewHtml(raw: string, nonce: string, theme: Theme): string {
  raw = raw.replace('data-theme="dark"', `data-theme="${theme}"`);
  const head = raw.indexOf('<head>');
  if (head < 0) throw new Error('The bundled web app has no <head>.');
  const at = head + '<head>'.length;
  const injected =
    `\n<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(nonce)}">` +
    `\n<script>${HOST_SHIM}</script>`;
  return addScriptNonces(raw.slice(0, at) + injected + raw.slice(at), nonce);
}

// Adds the nonce to every <script> tag in the markup. Walks tag by tag and
// jumps over each script's body, so a "<script" that a string literal in the
// inlined bundle might contain is never mistaken for a tag.
export function addScriptNonces(html: string, nonce: string): string {
  let out = '';
  let pos = 0;
  const open = /<script\b([^>]*)>/gi;
  for (;;) {
    open.lastIndex = pos;
    const match = open.exec(html);
    if (!match) break;
    const attrs = match[1].replace(/\snonce="[^"]*"/i, '');
    out += html.slice(pos, match.index) + `<script nonce="${nonce}"${attrs}>`;
    const bodyStart = match.index + match[0].length;
    const close = html.toLowerCase().indexOf('</script', bodyStart);
    const bodyEnd = close < 0 ? html.length : close;
    out += html.slice(bodyStart, bodyEnd);
    pos = bodyEnd;
  }
  return out + html.slice(pos);
}

export function errorHtml(message: string): string {
  const escaped = message.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return `<!doctype html><html><body style="font-family:sans-serif;padding:16px;">${escaped}</body></html>`;
}

// Web Crypto rather than node:crypto, so this also runs in a web extension.
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
