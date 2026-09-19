import { Injectable, signal } from '@angular/core';

// A "node" is a single key/value pair anywhere in the tree (an object entry,
// an array item, or an array-of-objects cell). Filtering works on the whole
// tree at once:
//   1. Find every node whose key (and, depending on mode, value) contains
//      the search text.
//   2. Keep those nodes visible, plus every ancestor (so matches stay
//      reachable) and every descendant (so a matched branch shows in full).
//   3. Depending on mode, also widen visibility to a match's siblings (see
//      FilterMode below).
//   4. Hide everything else.
export type FilterMode = 'value' | 'field' | 'object' | 'context';

@Injectable({ providedIn: 'root' })
export class FilterService {
  readonly text = signal('');
  // 'value'   — match key or value text; show only the path to each match.
  // 'field'   — match key names only (ignore value text); show only the
  //             path to each match. For "give me every 'description'
  //             field" style searches, where matching on value text too
  //             would pull in unrelated fields that merely mention the word.
  // 'object'  — match key or value text; also show every sibling of the
  //             object/row directly containing the match, in full, so the
  //             whole record is visible instead of just the one field that
  //             matched.
  // 'context' — match key or value text; like 'object', but widens at every
  //             ancestor level up to the root, not just the immediate
  //             container.
  readonly mode = signal<FilterMode>('value');

  set(value: string): void {
    this.text.set(value);
  }

  setMode(mode: FilterMode): void {
    this.mode.set(mode);
  }

  clear(): void {
    this.text.set('');
  }

  private term(): string {
    return this.text().trim().toLowerCase();
  }

  // True if this exact node — its key, or (unless in 'field' mode) its
  // value if the value is a primitive — contains the search text. Does not
  // look at descendants.
  directMatch(key: string | null, value: unknown): boolean {
    const term = this.term();
    if (!term) return true;
    if (key !== null && key.toLowerCase().includes(term)) return true;
    if (this.mode() === 'field') return false;
    if (value === null || value === undefined) return false;
    if (typeof value === 'object') return false;
    return String(value).toLowerCase().includes(term);
  }

  // True if this node matches directly, or if any node in its subtree does.
  // Used to decide whether a node should be visible as an ancestor of a match.
  treeMatch(key: string | null, value: unknown): boolean {
    const term = this.term();
    if (!term) return true;
    if (this.directMatch(key, value)) return true;
    if (value === null || typeof value !== 'object') return false;
    if (Array.isArray(value)) {
      return value.some(item => this.treeMatch(null, item));
    }
    return Object.entries(value as Record<string, unknown>).some(([k, v]) => this.treeMatch(k, v));
  }

  // True in 'context' mode when one of the entries in this sibling group
  // matches directly (key or primitive value). Such a group is the matching
  // node itself, so every sibling is shown in full, including its whole
  // subtree — unlike ancestor groups, which only get their keys widened.
  fullGroupMatch(entries: Array<[string | null, unknown]>): boolean {
    if (!this.term() || this.mode() !== 'context') return false;
    return entries.some(([k, v]) => this.directMatch(k, v));
  }

  // True if the current mode wants every entry in this sibling group shown
  // in full because the search matched inside the group. 'object' mode only
  // widens the group directly containing a match (a direct match on one of
  // the entries); 'context' mode widens every group along the path to a
  // match (any entry whose subtree contains a match), which cascades the
  // widening up through every ancestor level.
  groupMatch(entries: Array<[string | null, unknown]>): boolean {
    if (!this.term()) return false;
    switch (this.mode()) {
      case 'object':
        return entries.some(([k, v]) => this.directMatch(k, v));
      case 'context':
        return entries.some(([k, v]) => this.treeMatch(k, v));
      default:
        return false;
    }
  }
}
