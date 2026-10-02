# VS Code extension — plan

A third host for the JSON Canopy web app, next to the standalone page and
the IntelliJ plugin. This file is the persistent record of the design
decisions and progress, kept in the repo so work can continue from any
machine on the `vs-code-plugin` branch.

## Goal

Open a `.json` file in VS Code and get the same Canopy view the IntelliJ
plugin gives: tables/form, editing that writes back into the real file
(undo, dirty state and save behave like any VS Code editor), live updates
when the file changes elsewhere, the editor's light/dark theme, and the
schema found the same way as in IntelliJ, as far as VS Code allows.

## Why this is mostly a port

The Angular app already talks to "a host" through a small, host-neutral
wire contract (`host-bridge.service.ts`, mirrored by `BridgeMessages.kt`):

| Direction    | Message           | Meaning                                   |
|--------------|-------------------|-------------------------------------------|
| page → host  | `READY`           | bridge registered, send the document      |
| host → page  | `LOAD_DOCUMENT`   | file name, text, read-only flag           |
| page → host  | `DOCUMENT_CHANGED`| a user edit, full text (debounced 300 ms) |
| host → page  | `EXTERNAL_RELOAD` | the file changed somewhere else           |
| host → page  | `SET_SCHEMA`      | found / needsConsent / none / failed      |
| page → host  | `FETCH_SCHEMA`    | the user agreed to download a remote URL  |

The page only needs two globals, set before it boots:
`window.__JSON_CANOPY_HOST__ = true` and `window.__canopySendToHost(json)`.
It answers on `window.__canopyHost.dispatch(json)`. In a VS Code webview
both directions map onto `acquireVsCodeApi().postMessage` and the
`message` event, so a ten-line injected shim is the whole page-side port.
**The Angular code should not need to change** for steps 1–3.

## Decisions (locked in)

- **Location and language.** New top-level folder `vscode-extension/`,
  sibling of `intellij-plugin/`. TypeScript, bundled with esbuild into one
  `dist/extension.js`. Own `package.json`; the root Angular project is not
  touched except for the build output it already produces.
- **Editor type: `CustomTextEditorProvider`** (not `CustomEditorProvider`).
  It edits VS Code's own `TextDocument`, so undo/redo, dirty marker, save,
  hot exit, "Reopen With → Text Editor" and the side-by-side text tab all
  come for free and stay consistent — the same role the platform
  `Document` plays in `CanopyFileEditor.kt`.
- **Write-back.** `DOCUMENT_CHANGED` → one `WorkspaceEdit` replacing the
  full document range. Same echo guard as IntelliJ: remember
  `lastKnownText` before applying, and in `onDidChangeTextDocument` drop
  the event when the new text equals it; anything else is an
  `EXTERNAL_RELOAD` (plus a schema re-resolve, since `$schema` may have
  changed). Skip the edit entirely if the text is unchanged.
- **Activation: "Open With…", not the default.** Register for
  `*.json` only (not `.jsonc`: comments would be dropped on the first
  edit) with `"priority": "option"`. Add a command "Open in JSON Canopy" and an
  editor-title button on JSON text editors. Users who want it as default
  can set `workbench.editorAssociations` themselves.
- **Page loading: the existing single-file `index.html`,** read from the
  extension folder, with the host shim injected into `<head>` exactly as
  `CanopyFileEditor.loadHostedHtml()` does, and the initial `data-theme`
  replaced the same way. Rationale: one build artefact for all three
  hosts, no `asWebviewUri` rewriting of asset paths.
- **Content Security Policy.** Webviews should carry a CSP. Because the
  page is one file with inline `<script>`/`<style>`, the CSP uses a
  per-load nonce: the extension adds `nonce="…"` to every inline
  `<script>` tag while injecting the shim. Required
  allowances:
  - `script-src 'nonce-…' 'unsafe-eval'` — **Ajv compiles validators with
    `new Function`** (`src/app/schema/schema-validator.ts`), so without
    `unsafe-eval` schema validation breaks. (Alternative: Ajv standalone
    precompilation — not possible, schemas are only known at runtime.)
  - `style-src 'unsafe-inline'`, no nonce — Angular adds component
    `<style>` elements and `style="…"` attributes at runtime, and a nonce
    in the policy would make browsers ignore `'unsafe-inline'`. So only
    `<script>` tags get the nonce.
  - `img-src data:` (inlined favicon), `default-src 'none'`.
  - No `connect-src`: the page never fetches; remote schemas go through
    the extension (`FETCH_SCHEMA`), as in IntelliJ.
- **Theme.** VS Code sets `vscode-light` / `vscode-dark` /
  `vscode-high-contrast` / `vscode-high-contrast-light` on the webview's
  `<body>`. The injected shim maps that to `data-theme` once at start and
  on change (a `MutationObserver` on `body.className`). High contrast maps
  to the nearest of light/dark for v1. No extension-side theme code.
  Initial attribute: from `window.activeColorTheme.kind`, replaced into
  the HTML before load to avoid a flash, as in IntelliJ.
- **Schema resolution** — the one part that is not a straight port.
  IntelliJ asks the JSON plugin which schema applies; VS Code's built-in
  JSON language service exposes **no API** for that. So the extension
  resolves it itself, in the same order as `SchemaResolver.kt`:
  1. local `$schema` in the file (relative to the file, absolute path,
     `file:` URI) → read via `workspace.fs` (picks up unsaved edits if the
     schema is open: prefer an open `TextDocument`'s text);
  2. the user's `json.schemas` setting (workspace + user scope):
     `fileMatch` globs against the workspace-relative path, then `url`
     (local path relative to the workspace folder, or remote) or inline
     `schema` object;
  3. a remote `$schema` (or remote `url` from step 2) → `needsConsent`;
     after the page's `FETCH_SCHEMA`, download with `fetch` (Node 18+
     global in the extension host; it ignores `http.proxy`, accepted for
     v1). Same guard as IntelliJ: only the URL that was
     offered may be fetched; the result is cached for the editor's life.
  4. otherwise `none`; a local reference that can't be read → `failed`.
  **Not in v1:** SchemaStore catalogue matching (VS Code's JSON service
  does this automatically; we'd have to download and cache the catalogue)
  and schemas contributed by other extensions via `jsonValidation`.
- **Code sharing with Kotlin:** none. The wire contract lives in
  `host-bridge.service.ts` (source of truth) and is mirrored a third time
  in `vscode-extension/src/bridge.ts`, the same way `BridgeMessages.kt`
  mirrors it (importing the Angular file would drag `@angular/core` into
  the extension's type check).
- **Webview kept alive when hidden** (`retainContextWhenHidden`), so
  switching tabs doesn't reload the page and lose expand/scroll state —
  matches the JCEF panel's behaviour, costs memory per open tab.
- **Desktop only for v1.** Use only `workspace.fs` and global `fetch` (no
  `fs`/`path` Node imports in the resolver) so a later web-extension
  build for vscode.dev stays possible, but don't build or test it now.
- **Packaging.** `npm run build` in `vscode-extension/` runs the root
  Angular build if needed, copies `dist/json-canopy/browser/index.html`
  to `vscode-extension/webview/index.html`, bundles the extension, and
  `vsce package` produces a `.vsix`. Publishing (Marketplace / Open VSX,
  publisher id) is out of scope for this plan.

## Known, accepted limitations for v1

- A page edit replaces the whole document with
  `JSON.stringify(data, null, 2)`: comments (`.jsonc`) and the file's own
  formatting are lost on the first Canopy edit. Same as IntelliJ today.
  The file's line endings and final newline are kept.
- An edit made in the page less than 300 ms before its tab is closed is
  lost (the page debounces DOCUMENT_CHANGED). Same as IntelliJ.
- One undo step per debounced page edit (300 ms batches), and undo
  reloads the whole page state via `EXTERNAL_RELOAD` (expand/scroll state
  may reset). Same as IntelliJ.
- Two Canopy tabs on the same file each get every change as
  `EXTERNAL_RELOAD`; no smarter merging.
- Remembered layout (browser storage) — webview storage is not
  guaranteed to persist; see open questions.

## Steps

Each step ends in something visible in an Extension Development Host
(`F5` with a `launch.json` entry for `extensionHost`).

1. **Scaffold and show a file (read-only).** `vscode-extension/`
   package, provider registration, HTML load with shim + CSP + nonce,
   `READY` → `LOAD_DOCUMENT`. Check: a sample opens via "Open With…",
   Ajv-based validation works under the CSP (no console CSP errors).
2. **Write-back and external changes.** `DOCUMENT_CHANGED` →
   `WorkspaceEdit`; `onDidChangeTextDocument` → `EXTERNAL_RELOAD` with
   echo guard; `readOnly` from the file system (`FileSystemProvider`
   permissions / untitled / git diff views). Check: edit in Canopy →
   text tab updates, dirty dot, Ctrl+Z / Ctrl+S work (with focus in the
   webview too), edit in text tab → Canopy updates, `git checkout` of
   the file → Canopy updates, no edit loops.
3. **Theme.** Shim-side class → `data-theme` mapping, initial theme in
   the HTML. Check: switching color theme updates open tabs live.
4. **Schema.** Resolver (steps 1–4 above), `SET_SCHEMA` after load and on
   every external change, `FETCH_SCHEMA` with offered-URL guard. Unit
   tests for glob matching and `$schema` classification (vitest, already
   in the repo). Check against `samples/` with a local `$schema`, a
   `json.schemas` mapping, and a remote `$schema` (consent prompt,
   download, cached on re-resolve).
5. **Entry points and polish.** Command + editor-title button,
   extension icon (reuse `pluginIcon.svg`), README for the extension,
   `.vsix` build, manual test on a large sample file.

## Open questions

- **Persisted layout choice.** Move it from browser storage to host
  storage through a new bridge message (`SAVE_STATE` / `globalState`),
  which would also fix the same open question in IntelliJ?
- **Undo while the webview has focus.** VS Code routes the undo command
  to the text document for custom *text* editors; verify in step 2 that
  this also holds when a Canopy input field has focus (it may undo text
  in the input instead — which might be the right thing).

## Progress

- [x] Plan agreed
- [x] Step 1: scaffold, show a file
  - [x] `vscode-extension/`: provider, shim + CSP + nonces, `READY` → `LOAD_DOCUMENT` (read-only), log channel "JSON Canopy"
  - [x] Unit tests (`npm test` in `vscode-extension/`): HTML preparation, message decoding
  - [x] Page under the real CSP in headless Chromium with a stand-in `acquireVsCodeApi`: no violations, schema validated (7 problems on `team-invalid.json`); control run without `'unsafe-eval'` fails as expected
  - [x] Real VS Code 1.139 (Flatpak), isolated profile in `vscode-extension/.vscode-test/`: activates on `onCustomEditor`, page sends READY, document loaded. The rendered page itself was not looked at there — check with F5 ("VS Code extension" launch config)
- [x] Step 2: write-back, external changes
  - [x] `DocumentSync` (no `vscode` import, unit-tested): echo guard comparing with line endings normalised (VS Code keeps a file's CRLF), file's final newline kept, failed edit reloads the page from the file
  - [x] Read-only for read-only file systems (git: diff views etc.); a write-protected local file stays editable, as in VS Code's text editor
  - [x] Trace logging of every bridge message (Output → "JSON Canopy", level Trace)
  - [x] Scripted run in VS Code 1.139 (`--extensionTestsPath`): CRLF file opens, an external edit reaches the page as one EXTERNAL_RELOAD
  - [x] Manual (installed `.vsix`, real VS Code): edit in the page → text tab, dirty dot, undo/save, text tab → page
- [x] Step 3: theme
  - [x] Shim follows VS Code's body class (light, dark, both high-contrast kinds) via a MutationObserver; initial `data-theme` from `activeColorTheme.kind` written into the markup
  - [x] Headless Chromium: all four classes map correctly and switch live, under the CSP
  - [x] Manual: opens in the current theme, follows a theme switch live (after a window reload: a reinstalled same-version `.vsix` keeps the old code running until then)
- [ ] Step 4: schema
- [ ] Step 5: entry points, packaging
