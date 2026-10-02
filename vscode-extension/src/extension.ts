import * as vscode from 'vscode';
import { CanopyEditorProvider } from './canopyEditor';

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('JSON Canopy', { log: true });
  context.subscriptions.push(log, CanopyEditorProvider.register(context, log));
}

export function deactivate(): void {}
