import { Component, computed, effect, inject, signal } from '@angular/core';
import { JsonExplorerComponent } from './json-explorer/json-explorer.component';
import { EditModeService } from './json-explorer/services/edit-mode.service';
import { HostBridgeService, type SetSchemaPayload } from './json-explorer/services/host-bridge.service';
import { CollapseService } from './json-explorer/services/collapse.service';
import { RevealService } from './json-explorer/services/reveal.service';
import { SchemaService } from './json-explorer/services/schema.service';
import { JumpService } from './json-explorer/services/jump.service';
import { LayoutService } from './json-explorer/services/layout.service';
import type { Layout } from './json-explorer/layout.util';
import { formatPath, isRemoteSchemaRef, schemaRefOf, type Problem } from './schema';

@Component({
  selector: 'app-root',
  imports: [JsonExplorerComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private editMode = inject(EditModeService);
  private reveal = inject(RevealService);
  private collapse = inject(CollapseService);
  protected hostBridge = inject(HostBridgeService);
  protected schema = inject(SchemaService);
  private jump = inject(JumpService);
  protected layout = inject(LayoutService);

  protected readonly data = signal<unknown>(undefined);
  protected readonly fileName = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly draft = signal('');
  protected readonly dragging = signal(false);

  protected readonly rawMode = signal(false);
  protected readonly rawDraft = signal('');
  protected readonly copied = signal(false);

  protected readonly hasData = () => this.data() !== undefined;

  // What the document itself says its schema is, so the schema bar can
  // point at the file to choose. Resolving it is left to the user for now.
  protected readonly schemaRef = computed(() => schemaRefOf(this.data()));

  // A remote schema is never fetched unasked: the bar offers it, the user
  // decides. `declined` remembers "not now" for this session.
  protected readonly remoteRef = computed(() => {
    const ref = this.schemaRef();
    return ref && isRemoteSchemaRef(ref) ? ref : undefined;
  });
  private readonly declined = signal<string[]>([]);
  protected readonly fetching = signal(false);

  // In the IDE the host resolves schemas and says when one needs asking about.
  private readonly hostConsentUrl = signal<string | undefined>(undefined);
  // A schema the user chose by hand is not replaced by what the host finds.
  private pinned = false;
  // Whether the loaded schema came from the host, so the host may take it away again.
  private fromHost = false;

  // The remote schema the file points at that nobody has loaded, if it may be offered.
  protected readonly consentUrl = computed(() => {
    const url = this.schema.model() ? undefined : this.hostBridge.isHostMode() ? this.hostConsentUrl() : this.remoteRef();
    return url && !this.declined().includes(url) ? url : undefined;
  });

  protected readonly problemsOpen = signal(false);
  // A huge document can fail thousands of times over; the list shows the first few.
  protected readonly problemListLimit = 200;
  protected readonly formatPath = formatPath;

  // Debounce timer for pushing user edits back to the host — coalesces
  // rapid-fire edits (e.g. dragging through several cell edits) into one
  // DOCUMENT_CHANGED instead of a write-back per keystroke/cell.
  private notifyHostTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => this.schema.setData(this.data()));
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
    this.hostBridge.onSetSchema((payload) => this.onHostSchema(payload));
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

  setLayout(mode: Layout): void {
    this.layout.choose(mode);
  }

  removeSchema(): void {
    this.pinned = false;
    this.dropSchema();
  }

  jumpTo(problem: Problem): void {
    this.jump.to(problem, this.data());
  }

  onSchemaSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        if (this.useSchema(reader.result as string, file.name, 'chosen file')) {
          this.pinned = true;
          this.fromHost = false;
        }
      };
      reader.readAsText(file);
    }
    input.value = '';
  }

  async fetchSchema(url: string): Promise<void> {
    this.fetching.set(true);
    if (this.hostBridge.isHostMode()) {
      // The IDE downloads it and answers with SET_SCHEMA.
      this.hostBridge.fetchSchema(url);
      return;
    }
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.useSchema(await response.text(), url.split('/').pop() || url, `downloaded from ${url}`);
    } catch (e) {
      this.schema.fail(`Could not fetch ${url}: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.fetching.set(false);
    }
  }

  declineSchema(url: string): void {
    this.declined.update(list => [...list, url]);
  }

  private useSchema(text: string, name: string, origin: string): boolean {
    const loaded = this.schema.load(text, name, origin);
    if (loaded) this.layout.suggest(this.data(), true);
    return loaded;
  }

  private onHostSchema(payload: SetSchemaPayload): void {
    this.fetching.set(false);
    if (this.pinned) return;
    switch (payload.status) {
      case 'found':
        this.hostConsentUrl.set(undefined);
        if (payload.text !== undefined) this.fromHost = this.useSchema(payload.text, payload.name ?? 'schema', payload.source ?? 'IDE');
        break;
      case 'needsConsent':
        this.hostConsentUrl.set(payload.url);
        break;
      case 'failed':
        this.schema.fail(payload.message ?? 'The schema could not be loaded.');
        break;
      case 'none':
        this.hostConsentUrl.set(undefined);
        if (this.fromHost) this.dropSchema();
        break;
    }
  }

  private dropSchema(): void {
    this.fromHost = false;
    this.schema.clear();
    this.layout.suggest(this.data(), false);
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
      const parsed = JSON.parse(text);
      this.data.set(parsed);
      this.fileName.set(fileName);
      this.error.set(null);
      this.editMode.reset();
      // A new document starts without the last one's layout choice.
      this.layout.reset();
      this.layout.suggest(parsed, this.schema.model() !== undefined);
      // Reveal counts describe THIS document's array/object sizes, not a
      // view preference worth carrying over to the next file — unlike
      // orientation/hidden-column state, which deliberately persists.
      this.reveal.clear();
      this.collapse.clear();
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
