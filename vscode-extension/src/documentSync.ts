import { OutgoingMessage } from './bridge';

// What DocumentSync needs from VS Code: the TextDocument's text, a way to
// replace it (a WorkspaceEdit, so it joins undo/redo and marks the editor
// dirty), and the page. Kept as an interface so this logic is unit-tested
// without the `vscode` module.
export interface SyncHost {
  getText(): string;
  replaceText(text: string): Thenable<boolean>;
  post(message: OutgoingMessage): void;
  warn(message: string): void;
}

/**
 * Keeps one Canopy page and the TextDocument it shows in step — the
 * counterpart of the `lastKnownText` handling in the IntelliJ plugin's
 * CanopyFileEditor.
 *
 * [lastKnownText] is the text the page and the document last agreed on.
 * A document change that produces exactly that text is our own write-back
 * echoing back and is dropped; anything else came from elsewhere (the text
 * editor tab, undo, git, another Canopy tab) and goes to the page as
 * EXTERNAL_RELOAD. Without the guard a page edit would bounce back to the
 * page as a reload, resetting its expand/scroll state on every edit.
 *
 * Texts are compared with line endings normalised: VS Code keeps a file's
 * own EOL, so the page's "\n" text lands in a CRLF file as "\r\n".
 */
export class DocumentSync {
  private lastKnownText: string | null = null;

  constructor(
    private readonly host: SyncHost,
    private readonly fileName: string,
    private readonly readOnly: boolean,
  ) {}

  // READY: also after the page reloads, so always the current text.
  onPageReady(): void {
    const text = this.host.getText();
    this.lastKnownText = normalizeEol(text);
    this.host.post({ type: 'LOAD_DOCUMENT', payload: { fileName: this.fileName, text, readOnly: this.readOnly } });
  }

  // DOCUMENT_CHANGED: a user edit in the page.
  async onPageEdit(pageText: string): Promise<void> {
    if (this.readOnly) {
      this.host.warn(`Ignoring an edit from the page: ${this.fileName} is read-only.`);
      return;
    }
    const current = this.host.getText();
    const text = keepFinalNewline(current, pageText);
    if (normalizeEol(text) === normalizeEol(current)) {
      this.lastKnownText = normalizeEol(current);
      return;
    }
    // Set before writing: the change event fires while the edit is applied,
    // and must recognise it as our own.
    this.lastKnownText = normalizeEol(text);
    const applied = await this.host.replaceText(text);
    if (!applied) {
      // The page now shows something the file does not have; put the page
      // back on the file's text rather than leave them apart.
      this.host.warn(`Could not write the edit into ${this.fileName}; reloading the page from the file.`);
      this.onDocumentChanged(true);
    }
  }

  // The TextDocument changed, from wherever.
  onDocumentChanged(force = false): void {
    const text = this.host.getText();
    const normalized = normalizeEol(text);
    if (!force && normalized === this.lastKnownText) return;
    this.lastKnownText = normalized;
    this.host.post({ type: 'EXTERNAL_RELOAD', payload: { text } });
  }
}

export function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

// The page serialises with JSON.stringify, which has no final newline. Keep
// the file's, so a Canopy edit doesn't show up as "\ No newline at end of
// file" in every diff.
export function keepFinalNewline(current: string, next: string): string {
  return current.endsWith('\n') && !next.endsWith('\n') ? next + '\n' : next;
}
