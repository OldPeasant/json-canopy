import * as vscode from 'vscode';
import { decode, encode } from './bridge';
import { DocumentSync } from './documentSync';
import { buildWebviewHtml, errorHtml, newNonce } from './webviewHtml';

/**
 * Hosts the JSON Canopy web app (built by the Angular project one directory
 * up, copied into `webview/` by `npm run copy:webview`) in a webview, as a
 * custom *text* editor: the page works on VS Code's own TextDocument, the
 * same document the built-in text editor edits — the role the platform
 * Document plays in the IntelliJ plugin's CanopyFileEditor. Page edits go
 * in as WorkspaceEdits, so undo/redo, the dirty marker and save are VS
 * Code's own; DocumentSync keeps page and document in step.
 */
export class CanopyEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'jsonCanopy.editor';

  static register(context: vscode.ExtensionContext, log: vscode.LogOutputChannel): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(CanopyEditorProvider.viewType, new CanopyEditorProvider(context, log), {
      // Keep the page alive in background tabs so switching tabs doesn't
      // reload it and lose expand/scroll state, as the JCEF panel behaves.
      webviewOptions: { retainContextWhenHidden: true },
    });
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    // No localResourceRoots: the page is one self-contained file and loads
    // nothing from disk.
    panel.webview.options = { enableScripts: true, localResourceRoots: [] };

    const name = fileName(document.uri);
    const readOnly = await isReadOnly(document.uri);
    const sync = new DocumentSync(
      {
        getText: () => document.getText(),
        replaceText: (text) => {
          const edit = new vscode.WorkspaceEdit();
          edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), text);
          return vscode.workspace.applyEdit(edit);
        },
        post: (message) => {
          this.log.trace(`→ page: ${message.type} (${name})`);
          void panel.webview.postMessage(encode(message));
        },
        warn: (message) => this.log.warn(message),
      },
      name,
      readOnly,
    );

    // Subscribed before the page is loaded, so its READY can't be missed.
    const subscriptions = [
      panel.webview.onDidReceiveMessage((raw) => {
        const message = decode(raw);
        if (!message) {
          this.log.warn('Ignoring a malformed message from the page:', raw);
          return;
        }
        this.log.trace(`← page: ${message.type} (${name})`);
        switch (message.type) {
          case 'READY':
            this.log.info(`Page ready, loading ${document.uri.toString(true)}${readOnly ? ' (read-only)' : ''}`);
            sync.onPageReady();
            break;
          case 'DOCUMENT_CHANGED':
            void sync.onPageEdit(message.payload.text);
            break;
          case 'FETCH_SCHEMA':
            // Step 4.
            break;
        }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        // Events without content changes only report dirty-state changes.
        if (event.document === document && event.contentChanges.length > 0) sync.onDocumentChanged();
      }),
    ];
    panel.onDidDispose(() => subscriptions.forEach((s) => s.dispose()));

    panel.webview.html = await this.loadHtml();
  }

  private async loadHtml(): Promise<string> {
    const uri = vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'index.html');
    let raw: string;
    try {
      raw = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      return errorHtml("JSON Canopy's bundled web app is missing from this extension build.");
    }
    return buildWebviewHtml(raw, newNonce());
  }
}

// Read-only file systems (git: and other diff views, some remote ones) and
// files their provider reports as read-only. A write-protected local file is
// not: like VS Code's own text editor (unless `files.readonlyFromPermissions`
// is set), we let the user edit it and VS Code asks to overwrite on save.
// An untitled document has nothing on disk to stat and is writable.
async function isReadOnly(uri: vscode.Uri): Promise<boolean> {
  if (vscode.workspace.fs.isWritableFileSystem(uri.scheme) === false) return true;
  if (uri.scheme === 'untitled') return false;
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return ((stat.permissions ?? 0) & vscode.FilePermission.Readonly) !== 0;
  } catch {
    return false;
  }
}

function fileName(uri: vscode.Uri): string {
  return uri.path.substring(uri.path.lastIndexOf('/') + 1);
}
