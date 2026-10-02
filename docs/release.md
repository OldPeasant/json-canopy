# Releasing

The IntelliJ plugin and the VS Code extension are released together, with
one version number. This is the checklist; the first section is a one-time
setup.

## One version, one changelog

- The version lives in the root `package.json`. Gradle reads it from there
  (`intellij-plugin/build.gradle.kts`); `vscode-extension/package.json`
  must carry the same one, and the extension's build stops if it doesn't.
  To change it:

  ```bash
  npm version X.Y.Z --no-git-tag-version
  (cd vscode-extension && npm version X.Y.Z --no-git-tag-version)
  ```

- `CHANGELOG.md` is the source of both the IntelliJ change notes (turned
  into HTML at build time; `./gradlew printChangeNotes` in
  `intellij-plugin/` shows the result) and the VS Code Marketplace's
  Changelog tab (copied into the extension at build time). Add a
  `## X.Y.Z` section at the top for every release.

## One-time setup

**VS Code Marketplace** (publisher `sonensei`, as in
`vscode-extension/package.json`):

1. Sign in at <https://marketplace.visualstudio.com/manage> with a
   Microsoft account and create the publisher with ID `sonensei`.
2. In Azure DevOps (<https://dev.azure.com>, any organisation) create a
   personal access token: *Organization: All accessible organizations*,
   *Scopes: Custom defined → Marketplace → Manage*. Keep it somewhere safe.

**Open VSX** (optional; the registry VSCodium, Cursor, Windsurf, Gitpod
and others install from):

1. Sign in at <https://open-vsx.org> with GitHub, link an Eclipse account
   and accept the publisher agreement.
2. Create an access token under *Settings → Access Tokens*.
3. Once: `npx ovsx create-namespace sonensei -p <token>`.

**JetBrains Marketplace**: already set up (the plugin is published since
0.1.0). Signing keys and the publish token come from the environment, see
below.

## Release X.Y.Z

1. **Version and changelog** set as above; committed.
2. **Build both:**

   ```bash
   (cd vscode-extension && npm test && npm run package)   # json-canopy-X.Y.Z.vsix
   (cd intellij-plugin && ./gradlew buildPlugin verifyPlugin)
   ```

   `verifyPlugin` must say *Compatible* for every IDE
   (`intellij-plugin/build/reports/pluginVerifier/*/verification-verdict.txt`).
3. **Smoke test both in a real editor:**
   - VS Code: install the `.vsix` (Extensions → ⋯ → Install from VSIX…,
     reload the window), open a sample with JSON Canopy, edit, undo, save,
     switch theme, open a file with a `$schema`.
   - IntelliJ: `./gradlew runIde`, open a sample with the JSON Canopy tab,
     the same checks.
4. **Publish to the VS Code Marketplace** — the exact `.vsix` you tested:

   ```bash
   cd vscode-extension
   npx vsce publish --packagePath json-canopy-X.Y.Z.vsix -p <marketplace-token>
   ```

   (Or upload the `.vsix` on the publisher page: *New extension → Visual
   Studio Code*.) It is usually live within minutes.
5. **Publish to Open VSX** (optional):

   ```bash
   npx ovsx publish json-canopy-X.Y.Z.vsix -p <open-vsx-token>
   ```

6. **Publish to the JetBrains Marketplace:**

   ```bash
   cd intellij-plugin
   export CERTIFICATE_CHAIN=... PRIVATE_KEY=... PRIVATE_KEY_PASSWORD=...
   export PUBLISH_TOKEN=...      # token from plugins.jetbrains.com
   ./gradlew signPlugin publishPlugin
   ```

   JetBrains reviews every update before it appears; that can take a
   working day or two.
7. **Tag and push:**

   ```bash
   git tag -a vX.Y.Z -m "JSON Canopy X.Y.Z"
   git push origin main vX.Y.Z
   ```

   The VS Code README's screenshot is loaded from `main` on GitHub, so the
   release must be on `main` there.
