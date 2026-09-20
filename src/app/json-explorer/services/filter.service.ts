import { Injectable, inject, signal } from '@angular/core';
import { CollapseService } from './collapse.service';

// A "node" is a single key/value pair anywhere in the tree (an object entry,
// an array item, or an array-of-objects cell). Searching works on the whole
// tree at once and offers three views of the same matches:
//   'matches' — only what matched. A key match shows the key with its value
//               collapsed; a value match shows the value under a dimmed key.
//               Ancestors are shown only as dimmed path keys.
//   'path'    — every matching key or value, with its full hierarchy. A key
//               match also shows its whole value, sub-tree included;
//               ancestors show their normal keys but only the branches
//               leading to a match.
//   'context' — a match is shown with everything around it: all attributes of
//               the containing object, sibling subtrees included. Ancestors
//               show only the path; non-matching context is dimmed.
// Anything the filter leaves collapsed can be expanded by clicking it (see
// CollapseService).
export type FilterMode = 'matches' | 'path' | 'context';

@Injectable({ providedIn: 'root' })
export class FilterService {
  private collapse = inject(CollapseService);

  readonly text = signal('');
  readonly mode = signal<FilterMode>('path');
  // When set, only keys are searched; value text is ignored.
  readonly keysOnly = signal(false);

  set(value: string): void {
    this.text.set(value);
    this.collapse.clear();
  }

  setMode(mode: FilterMode): void {
    this.mode.set(mode);
    this.collapse.clear();
  }

  setKeysOnly(on: boolean): void {
    this.keysOnly.set(on);
    this.collapse.clear();
  }

  clear(): void {
    this.set('');
  }

  private term(): string {
    return this.text().trim().toLowerCase();
  }

  get active(): boolean {
    return this.term() !== '';
  }

  keyMatch(key: string | null): boolean {
    const term = this.term();
    return !!term && key !== null && key.toLowerCase().includes(term);
  }

  // Primitive values only; containers match through their descendants.
  valueMatch(value: unknown): boolean {
    const term = this.term();
    if (!term || this.keysOnly()) return false;
    if (value === null || value === undefined || typeof value === 'object') return false;
    return String(value).toLowerCase().includes(term);
  }

  // True if this exact node — its key, or its value if it's a primitive —
  // contains the search text. Does not look at descendants.
  directMatch(key: string | null, value: unknown): boolean {
    if (!this.active) return true;
    return this.keyMatch(key) || this.valueMatch(value);
  }

  // True if this node matches directly, or if any node in its subtree does.
  treeMatch(key: string | null, value: unknown): boolean {
    if (!this.active) return true;
    if (this.directMatch(key, value)) return true;
    return this.descendantMatch(value);
  }

  descendantMatch(value: unknown): boolean {
    if (value === null || typeof value !== 'object') return false;
    if (Array.isArray(value)) return value.some(item => this.treeMatch(null, item));
    return Object.entries(value as Record<string, unknown>).some(([k, v]) => this.treeMatch(k, v));
  }

  // This node matched in a way that shows its whole subtree: any match in
  // 'context' mode, a name match in 'path' mode.
  forces(key: string | null, value: unknown): boolean {
    if (!this.active) return false;
    switch (this.mode()) {
      case 'context': return this.directMatch(key, value);
      case 'path': return this.keyMatch(key);
      default: return false;
    }
  }

  // 'context' mode: one entry of this sibling group matched directly, so
  // every sibling is shown in full, subtree included.
  groupMatch(entries: Array<[string | null, unknown]>): boolean {
    if (!this.active || this.mode() !== 'context') return false;
    return entries.some(([k, v]) => this.directMatch(k, v));
  }

  // Whether the filter wants this node's value collapsed behind a click: only
  // in 'matches' mode, when its key matched but nothing about the value did.
  collapsedByFilter(key: string | null, value: unknown): boolean {
    if (!this.active || this.mode() !== 'matches') return false;
    return this.keyMatch(key) && !this.valueMatch(value) && !this.descendantMatch(value);
  }

  // Keys that are only there for structure or context, not because they matched.
  keyDim(key: string | null, value: unknown): boolean {
    if (!this.active) return false;
    switch (this.mode()) {
      case 'matches': return !this.keyMatch(key);
      case 'context': return !this.treeMatch(key, value);
      default: return false;
    }
  }

  // Splits text around case-insensitive occurrences of the search term.
  highlight(text: string, isKey: boolean): Array<{ t: string; hit: boolean }> {
    const term = this.term();
    if (!term || (!isKey && this.keysOnly())) return [{ t: text, hit: false }];
    const lower = text.toLowerCase();
    const parts: Array<{ t: string; hit: boolean }> = [];
    let from = 0;
    for (let i = lower.indexOf(term); i !== -1; i = lower.indexOf(term, from)) {
      if (i > from) parts.push({ t: text.slice(from, i), hit: false });
      parts.push({ t: text.slice(i, i + term.length), hit: true });
      from = i + term.length;
    }
    if (from < text.length) parts.push({ t: text.slice(from), hit: false });
    return parts.length ? parts : [{ t: text, hit: false }];
  }
}
