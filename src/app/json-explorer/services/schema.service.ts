import { Injectable, computed, signal } from '@angular/core';
import { ProblemIndex, SchemaModel, loadSchema } from '../../schema';

// The schema the current document is checked against, and the problems that
// result. Purely advisory: nothing here blocks or rewrites an edit — the
// document is validated on every change and the problems are just shown.
// With no schema loaded everything is empty, so the editor behaves exactly
// as it did before schemas existed.
@Injectable({ providedIn: 'root' })
export class SchemaService {
  private readonly _model = signal<SchemaModel | undefined>(undefined);
  private readonly _name = signal<string | undefined>(undefined);
  private readonly _error = signal<string | null>(null);
  private readonly data = signal<unknown>(undefined);

  readonly model = this._model.asReadonly();
  // Display name: the schema's title if it has one, else where it came from.
  readonly name = this._name.asReadonly();
  // Why the last attempt to load a schema failed, if it did.
  readonly error = this._error.asReadonly();

  readonly problems = computed(() => {
    const model = this._model();
    const data = this.data();
    return model && data !== undefined ? model.validate(data) : [];
  });

  readonly index = computed(() => new ProblemIndex(this.problems(), this.data()));

  // Called by `App` whenever the document changes.
  setData(data: unknown): void {
    this.data.set(data);
  }

  load(text: string, source: string): boolean {
    const result = loadSchema(text);
    if ('error' in result) {
      this._error.set(result.error);
      return false;
    }
    const title = result.model.root.title;
    this._model.set(result.model);
    this._name.set(typeof title === 'string' && title ? title : source);
    this._error.set(null);
    return true;
  }

  clear(): void {
    this._model.set(undefined);
    this._name.set(undefined);
    this._error.set(null);
  }
}
