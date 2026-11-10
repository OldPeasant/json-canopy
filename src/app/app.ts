import { Component, computed, effect, inject, signal } from '@angular/core';
import { JsonExplorerComponent } from './json-explorer/json-explorer.component';
import { EditModeService } from './json-explorer/services/edit-mode.service';
import { HostBridgeService, type SetSchemaPayload } from './json-explorer/services/host-bridge.service';
import { CollapseService } from './json-explorer/services/collapse.service';
import { RevealService } from './json-explorer/services/reveal.service';
import { SchemaService } from './json-explorer/services/schema.service';
import { JumpService } from './json-explorer/services/jump.service';
import { LayoutService } from './json-explorer/services/layout.service';
import { JsonLinesService } from './json-explorer/services/json-lines.service';
import type { Layout } from './json-explorer/layout.util';
import { formatLinePath, isJsonLinesFileName, parseJsonLines, type JsonLinesDoc } from './json-explorer/json-lines.util';
import { formatPath, isRemoteSchemaRef, schemaRefOf, type Problem } from './schema';

// What a text turned out to be: one JSON document, a JSON Lines file, or neither.
type Reading = { data: unknown } | { lines: JsonLinesDoc } | { error: string };

// One JSON document if the text is one, else JSON Lines if most of its lines
// are JSON. A file named .jsonl/.ndjson is always read as JSON Lines, even
// when it happens to be a single document (one line), so that it is written
// back as one.
function read(text: string, fileName: string | null): Reading {
  if (isJsonLinesFileName(fileName)) return { lines: parseJsonLines(text, true)! };
  try {
    return { data: JSON.parse(text) };
  } catch (e) {
    const lines = parseJsonLines(text);
    return lines ? { lines } : { error: e instanceof Error ? e.message : 'Invalid JSON' };
  }
}

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
  protected lines = inject(JsonLinesService);

  protected readonly data = signal<unknown>(undefined);
  protected readonly fileName = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly draft = signal('');
  protected readonly dragging = signal(false);

  protected readonly rawMode = signal(false);
  protected readonly rawDraft = signal('');
  protected readonly copied = signal(false);

  // Either `data` holds the document, or (JSON Lines) the lines service does.
  protected readonly hasData = () => this.data() !== undefined || this.lines.active();

  // What stands for the document where one value is needed: the document
  // itself, or the first line that is JSON.
  private readonly sample = computed(() => (this.lines.active() ? this.lines.first() : this.data()));

  // What the document itself says its schema is, so the schema bar can
  // point at the file to choose. Resolving it is left to the user for now.
  protected readonly schemaRef = computed(() => schemaRefOf(this.sample()));

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

  protected problemPath(problem: Problem): string {
    return this.lines.active() ? formatLinePath(problem.path) : formatPath(problem.path);
  }

  // Debounce timer for pushing user edits back to the host — coalesces
  // rapid-fire edits (e.g. dragging through several cell edits) into one
  // DOCUMENT_CHANGED instead of a write-back per keystroke/cell.
  private notifyHostTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const values = this.lines.values();
      if (values) this.schema.setLines(values);
      else this.schema.setData(this.data());
    });
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

  onLineChange(change: { index: number; value: unknown }): void {
    this.lines.setLine(change.index, change.value);
    this.notifyHostOfChange();
  }

  // The document as text, the way it is saved: pretty-printed JSON, or for a
  // JSON Lines file one line per line, unedited lines exactly as they were.
  private text(): string {
    return this.lines.active() ? this.lines.text() : JSON.stringify(this.data(), null, 2);
  }

  toggleRawMode(): void {
    if (this.rawMode()) {
      this.rawMode.set(false);
      this.error.set(null);
    } else {
      this.rawDraft.set(this.text());
      this.rawMode.set(true);
    }
  }

  onRawInput(event: Event): void {
    this.rawDraft.set((event.target as HTMLTextAreaElement).value);
  }

  applyRaw(): void {
    const reading = read(this.rawDraft(), this.fileName());
    if ('error' in reading) {
      this.error.set(reading.error);
      return;
    }
    this.show(reading);
    this.error.set(null);
    this.rawMode.set(false);
    this.notifyHostOfChange();
  }

  // Shows what `read` found, as the one document or as lines.
  private show(reading: { data: unknown } | { lines: JsonLinesDoc }): void {
    if ('lines' in reading) {
      this.data.set(undefined);
      this.lines.set(reading.lines);
    } else {
      this.lines.set(undefined);
      this.data.set(reading.data);
    }
  }

  cancelRaw(): void {
    this.rawMode.set(false);
    this.error.set(null);
  }

  async copyJson(): Promise<void> {
    await navigator.clipboard.writeText(this.text());
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1200);
  }

  downloadJson(): void {
    const linesMode = this.lines.active();
    const blob = new Blob([this.text()], { type: linesMode ? 'application/x-ndjson' : 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.fileName() ?? (linesMode ? 'data.jsonl' : 'data.json');
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
    if (loaded) {
      this.layout.setSchema(this.schema.key());
      this.layout.suggest(this.sample(), true);
    }
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
    this.layout.setSchema(undefined);
    this.layout.suggest(this.sample(), false);
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
    this.lines.set(undefined);
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
    const reading = read(text, fileName);
    if ('error' in reading) {
      this.error.set(reading.error);
      return;
    }
    this.show(reading);
    this.fileName.set(fileName);
    this.error.set(null);
    this.editMode.reset();
    // A new document starts without the last one's layout choice.
    this.layout.reset();
    this.layout.suggest(this.sample(), this.schema.model() !== undefined);
    // Reveal counts describe THIS document's array/object sizes, not a
    // view preference worth carrying over to the next file — unlike
    // orientation/hidden-column state, which deliberately persists.
    this.reveal.clear();
    this.collapse.clear();
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
      this.hostBridge.documentChanged(this.text());
    }, 300);
  }
}
