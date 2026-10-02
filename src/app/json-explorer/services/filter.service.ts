import { Injectable, inject, signal } from '@angular/core';
import { CollapseService } from './collapse.service';

// A "node" is a single key/value pair anywhere in the tree (an object entry,
// an array item, or an array-of-objects cell). Searching works on the whole
// tree at once and offers two views of the same matches:
//   'strict'  — only what matched. A key match shows the key with its value
//               (a nested value collapsed); a value match shows the value
//               under a dimmed key. Ancestors are shown only as dimmed path
//               keys.
//   'context' — a match is shown in full, subtree included, together with
//               all its siblings (the other attributes of its object, or the
//               other items of its array). Along the path up to the root,
//               every ancestor's sibling attributes show too, collapsed when
//               nested; sibling items of an ancestor inside an array do not.
//               Non-matching context is dimmed.
// Anything the filter leaves collapsed can be expanded by clicking it (see
// CollapseService).
export type FilterMode = 'strict' | 'context';

@Injectable({ providedIn: 'root' })
export class FilterService {
  private collapse = inject(CollapseService);

  readonly text = signal('');
  readonly mode = signal<FilterMode>('strict');

  set(value: string): void {
    this.text.set(value);
    this.collapse.clear();
  }

  setMode(mode: FilterMode): void {
    this.mode.set(mode);
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
    if (!term) return false;
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

  // This node matched in a way that shows its whole subtree: any direct
  // match in 'context' mode.
  forces(key: string | null, value: unknown): boolean {
    return this.active && this.mode() === 'context' && this.directMatch(key, value);
  }

  // 'context' mode: one entry of this sibling group (an object's attributes,
  // or an array's items) matched directly, so every sibling is shown in
  // full, subtree included.
  groupMatch(entries: Array<[string | null, unknown]>): boolean {
    if (!this.active || this.mode() !== 'context') return false;
    return entries.some(([k, v]) => this.directMatch(k, v));
  }

  // 'context' mode: this object is on the way to a match, so all its
  // attributes are shown — the ones not leading to a match collapsed (see
  // collapsedByFilter). Arrays don't widen this way: sibling items of an
  // ancestor stay hidden.
  widens(entries: Array<[string, unknown]>): boolean {
    if (!this.active || this.mode() !== 'context') return false;
    return entries.some(([k, v]) => this.treeMatch(k, v));
  }

  // Whether the filter wants this node's nested value collapsed behind a
  // click (a plain value always shows). In 'strict' mode: its key matched but
  // nothing inside did. In 'context' mode: it is only there as an ancestor's
  // sibling.
  collapsedByFilter(key: string | null, value: unknown): boolean {
    if (!this.active || value === null || typeof value !== 'object') return false;
    if (this.mode() === 'context') return !this.treeMatch(key, value);
    return this.keyMatch(key) && !this.descendantMatch(value);
  }

  // Keys that are only there for structure or context, not because they matched.
  keyDim(key: string | null, value: unknown): boolean {
    if (!this.active) return false;
    return this.mode() === 'strict' ? !this.keyMatch(key) : !this.treeMatch(key, value);
  }

  // Splits text around case-insensitive occurrences of the search term.
  highlight(text: string): Array<{ t: string; hit: boolean }> {
    const term = this.term();
    if (!term) return [{ t: text, hit: false }];
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
