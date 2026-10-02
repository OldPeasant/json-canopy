import { describe, expect, it } from 'vitest';
import { addScriptNonces, buildWebviewHtml, contentSecurityPolicy, errorHtml, newNonce } from './webviewHtml';

const PAGE = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <style>body{}</style>
<script type="module">
const s = "<script>alert(1)</" + "script>"; const t = '<script src=x>';
</script>
</head>
<body><app-root></app-root></body>
</html>`;

describe('buildWebviewHtml', () => {
  const html = buildWebviewHtml(PAGE, 'abc', 'dark');

  it('puts the CSP and the host shim first in <head>, before the app bundle', () => {
    const csp = html.indexOf('Content-Security-Policy');
    const shim = html.indexOf('__JSON_CANOPY_HOST__ = true');
    const bundle = html.indexOf('<script nonce="abc" type="module">');
    expect(csp).toBeGreaterThan(html.indexOf('<head>'));
    expect(shim).toBeGreaterThan(csp);
    expect(bundle).toBeGreaterThan(shim);
  });

  it('gives every script tag the nonce, including the shim', () => {
    expect(html).toContain('<script nonce="abc">\nwindow.__JSON_CANOPY_HOST__');
    expect(html).toContain('<script nonce="abc" type="module">');
    expect(html.match(/<script nonce=/g)!.length).toBe(2);
  });

  it('leaves "<script" text inside a script body alone', () => {
    expect(html).toContain(`const s = "<script>alert(1)</" + "script>"; const t = '<script src=x>';`);
  });

  it('does not touch style tags', () => {
    expect(html).toContain('<style>body{}</style>');
  });

  it('rejects a page without <head>', () => {
    expect(() => buildWebviewHtml('<html></html>', 'abc', 'dark')).toThrow();
  });

  it('writes the initial theme into the markup', () => {
    expect(buildWebviewHtml(PAGE, 'abc', 'light')).toContain('<html lang="en" data-theme="light">');
    expect(html).toContain('<html lang="en" data-theme="dark">');
  });
});

describe('addScriptNonces', () => {
  it('replaces an existing nonce rather than adding a second one', () => {
    expect(addScriptNonces('<script nonce="old" defer></script>', 'new')).toBe('<script nonce="new" defer></script>');
  });

  it('copes with an unclosed script', () => {
    expect(addScriptNonces('<script>x', 'n')).toBe('<script nonce="n">x');
  });
});

describe('contentSecurityPolicy', () => {
  it('allows eval for Ajv and no network access', () => {
    const csp = contentSecurityPolicy('n');
    expect(csp).toContain("script-src 'nonce-n' 'unsafe-eval'");
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('connect-src');
  });

  it('does not list a nonce for styles, which would disable unsafe-inline', () => {
    expect(contentSecurityPolicy('n')).toMatch(/style-src 'unsafe-inline'(;|$)/);
  });
});

describe('newNonce', () => {
  it('is long, hex and different every time', () => {
    const a = newNonce();
    expect(a).toMatch(/^[0-9a-f]{48}$/);
    expect(newNonce()).not.toBe(a);
  });
});

describe('errorHtml', () => {
  it('escapes the message', () => {
    expect(errorHtml('<b>&')).toContain('&lt;b&gt;&amp;');
  });
});
