import { Injectable, computed, signal } from '@angular/core';
import { lineValues, serializeJsonLines, shownLineIndices, withLineValue, type JsonLinesDoc } from '../json-lines.util';

// The key RevealService pages the list of lines by, and how many it shows first.
export const LINES_REVEAL_KEY = '~lines';
export const LINES_INITIAL_COUNT = 50;

// The document, when the file is JSON Lines rather than one JSON document.
// `App` owns loading and saving; the explorer and the jump service read it.
@Injectable({ providedIn: 'root' })
export class JsonLinesService {
  private readonly _doc = signal<JsonLinesDoc | undefined>(undefined);

  readonly doc = this._doc.asReadonly();
  readonly active = computed(() => this._doc() !== undefined);

  // One entry per line: its value, or undefined for a line that is not JSON.
  readonly values = computed(() => {
    const doc = this._doc();
    return doc ? lineValues(doc) : undefined;
  });

  readonly shown = computed(() => {
    const doc = this._doc();
    return doc ? shownLineIndices(doc) : [];
  });

  // The first line that is JSON: what stands for the whole file where one
  // value is needed (its `$schema`, the default layout).
  readonly first = computed(() => this.values()?.find(v => v !== undefined));

  set(doc: JsonLinesDoc | undefined): void {
    this._doc.set(doc);
  }

  setLine(index: number, value: unknown): void {
    const doc = this._doc();
    if (doc) this._doc.set(withLineValue(doc, index, value));
  }

  text(): string {
    const doc = this._doc();
    return doc ? serializeJsonLines(doc) : '';
  }
}
