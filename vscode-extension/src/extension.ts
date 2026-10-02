import * as vscode from 'vscode';
import { CanopyEditorProvider } from './canopyEditor';

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('JSON Canopy', { log: true });
  context.subscriptions.push(
    log,
    CanopyEditorProvider.register(context, log),
    // From the text editor's title bar, the explorer and the palette.
    vscode.commands.registerCommand('jsonCanopy.open', async (uri?: unknown) => {
      const target = uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor?.document.uri;
      if (!target) {
        void vscode.window.showInformationMessage('Open a JSON file first.');
        return;
      }
      await vscode.commands.executeCommand('vscode.openWith', target, CanopyEditorProvider.viewType);
    }),
    // From Canopy's title bar: the same file as text, side by side.
    vscode.commands.registerCommand('jsonCanopy.openSource', async (uri?: unknown) => {
      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      const target = uri instanceof vscode.Uri ? uri : input instanceof vscode.TabInputCustom ? input.uri : undefined;
      if (target) await vscode.commands.executeCommand('vscode.openWith', target, 'default', vscode.ViewColumn.Beside);
    }),
  );
}

export function deactivate(): void {}
