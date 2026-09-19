import { Component, inject, signal } from '@angular/core';
import { JsonExplorerComponent } from './json-explorer/json-explorer.component';
import { EditModeService } from './json-explorer/services/edit-mode.service';
import { HostBridgeService } from './json-explorer/services/host-bridge.service';
import { RevealService } from './json-explorer/services/reveal.service';

@Component({
  selector: 'app-root',
  imports: [JsonExplorerComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private editMode = inject(EditModeService);
  private reveal = inject(RevealService);
  protected hostBridge = inject(HostBridgeService);

  protected readonly data = signal<unknown>(undefined);
  protected readonly fileName = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly draft = signal('');
  protected readonly dragging = signal(false);

  protected readonly rawMode = signal(false);
  protected readonly rawDraft = signal('');
  protected readonly copied = signal(false);

  protected readonly hasData = () => this.data() !== undefined;

  // Debounce timer for pushing user edits back to the host — coalesces
  // rapid-fire edits (e.g. dragging through several cell edits) into one
  // DOCUMENT_CHANGED instead of a write-back per keystroke/cell.
  private notifyHostTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (!this.hostBridge.isHostMode()) return;
    this.hostBridge.onLoadDocument((payload) => {
      // Set before parse() so the very first render already reflects it —
      // a read-only VFS file (e.g. under version control history, a
      // library dependency, a file without write permission) should never
      // let the user start editing only to find the write-back silently
      // can't persist. Only set on the initial load, not on every
      // EXTERNAL_RELOAD below, since a file's writability doesn't change
      // between opening it and a later external edit to the same file.
      this.editMode.setReadOnly(payload.readOnly);
      this.parse(payload.text, payload.fileName);
    });
    // v1: an external change just re-parses, same as opening a "new" file
    // (including the reset-to-view-mode side effect) — simplest correct
    // behavior for now; not attempting to preserve in-flight UI state
    // (raw-mode draft, edit-mode toggle) across an externally-driven reload.
    this.hostBridge.onExternalReload((text) => this.parse(text, this.fileName()));
    this.hostBridge.ready();
  }

  onDataChange(newValue: unknown): void {
    this.data.set(newValue);
    this.notifyHostOfChange();
  }

  toggleRawMode(): void {
    if (this.rawMode()) {
      this.rawMode.set(false);
      this.error.set(null);
    } else {
      this.rawDraft.set(JSON.stringify(this.data(), null, 2));
      this.rawMode.set(true);
    }
  }

  onRawInput(event: Event): void {
    this.rawDraft.set((event.target as HTMLTextAreaElement).value);
  }

  applyRaw(): void {
    try {
      this.data.set(JSON.parse(this.rawDraft()));
      this.error.set(null);
      this.rawMode.set(false);
      this.notifyHostOfChange();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Invalid JSON');
    }
  }

  cancelRaw(): void {
    this.rawMode.set(false);
    this.error.set(null);
  }

  async copyJson(): Promise<void> {
    await navigator.clipboard.writeText(JSON.stringify(this.data(), null, 2));
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1200);
  }

  downloadJson(): void {
    const blob = new Blob([JSON.stringify(this.data(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.fileName() ?? 'data.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  onDraftInput(event: Event): void {
    this.draft.set((event.target as HTMLTextAreaElement).value);
  }

  loadDraft(): void {
    this.parse(this.draft(), null);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.readFile(file);
    input.value = '';
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) this.readFile(file);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  onDragLeave(): void {
    this.dragging.set(false);
  }

  reset(): void {
    this.data.set(undefined);
    this.fileName.set(null);
    this.error.set(null);
    this.draft.set('');
    this.rawMode.set(false);
    this.rawDraft.set('');
  }

  private readFile(file: File): void {
    const reader = new FileReader();
    reader.onload = () => this.parse(reader.result as string, file.name);
    reader.readAsText(file);
  }

  private parse(text: string, fileName: string | null): void {
    try {
      this.data.set(JSON.parse(text));
      this.fileName.set(fileName);
      this.error.set(null);
      this.editMode.reset();
      // Reveal counts describe THIS document's array/object sizes, not a
      // view preference worth carrying over to the next file — unlike
      // orientation/hidden-column state, which deliberately persists.
      this.reveal.clear();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Invalid JSON');
    }
  }

  // Debounced write-back to the host — only ever called from genuine user
  // edits (onDataChange/applyRaw), never from parse() itself, so a
  // host-driven LOAD_DOCUMENT/EXTERNAL_RELOAD never echoes straight back
  // out as a DOCUMENT_CHANGED for the content the host just gave us.
  private notifyHostOfChange(): void {
    if (!this.hostBridge.isHostMode()) return;
    if (this.notifyHostTimer !== null) clearTimeout(this.notifyHostTimer);
    this.notifyHostTimer = setTimeout(() => {
      this.notifyHostTimer = null;
      this.hostBridge.documentChanged(JSON.stringify(this.data(), null, 2));
    }, 300);
  }
}
