import * as vscode from 'vscode';
import { decode, encode, OutgoingMessage } from './bridge';
import { buildWebviewHtml, errorHtml, newNonce } from './webviewHtml';

/**
 * Hosts the JSON Canopy web app (built by the Angular project one directory
 * up, copied into `webview/` by `npm run copy:webview`) in a webview, as a
 * custom *text* editor: the page works on VS Code's own TextDocument, the
 * same document the built-in text editor edits — the role the platform
 * Document plays in the IntelliJ plugin's CanopyFileEditor.
 *
 * Step 1 of docs/vscode-plan.md: the page shows the file, read-only.
 * Write-back and external changes are step 2.
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
    panel.webview.html = await this.loadHtml();

    const post = (message: OutgoingMessage) => panel.webview.postMessage(encode(message));

    const subscription = panel.webview.onDidReceiveMessage((raw) => {
      const message = decode(raw);
      if (!message) {
        this.log.warn('Ignoring a malformed message from the page:', raw);
        return;
      }
      switch (message.type) {
        case 'READY':
          this.log.info(`Page ready, loading ${document.uri.toString(true)}`);
          // Also after a reload of the page (e.g. "Developer: Reload
          // Webviews"): each READY gets the current text.
          post({
            type: 'LOAD_DOCUMENT',
            payload: { fileName: fileName(document.uri), text: document.getText(), readOnly: true },
          });
          break;
        case 'DOCUMENT_CHANGED':
        case 'FETCH_SCHEMA':
          // Steps 2 and 4.
          break;
      }
    });
    panel.onDidDispose(() => subscription.dispose());
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

function fileName(uri: vscode.Uri): string {
  return uri.path.substring(uri.path.lastIndexOf('/') + 1);
}
