import { Injectable, signal } from '@angular/core';
import { LayoutMemory } from '../layout-memory';
import { Layout, defaultLayout } from '../layout.util';

// Which of the two renderings of the same document is showing. The user's
// own choice always wins; until they make one, the layout is what they last
// chose for this schema, else what suits the document (see defaultLayout).
@Injectable({ providedIn: 'root' })
export class LayoutService {
  private readonly _mode = signal<Layout>('tables');
  private chosen = false;
  private schemaKey?: string;
  private memory = new LayoutMemory(() => (typeof localStorage === 'undefined' ? undefined : localStorage));

  readonly mode = this._mode.asReadonly();

  choose(mode: Layout): void {
    this.chosen = true;
    this._mode.set(mode);
    if (this.schemaKey) this.memory.set(this.schemaKey, mode);
  }

  // Which schema is loaded (undefined for none), so a choice is remembered
  // for it. Call before `suggest`.
  setSchema(key: string | undefined): void {
    this.schemaKey = key;
  }

  // Re-evaluates the default, unless the user has chosen for this document.
  suggest(data: unknown, hasSchema: boolean): void {
    if (this.chosen) return;
    const remembered = hasSchema && this.schemaKey ? this.memory.get(this.schemaKey) : undefined;
    this._mode.set(remembered ?? defaultLayout(data, hasSchema));
  }

  // A new document starts without the previous one's choice.
  reset(): void {
    this.chosen = false;
  }
}
