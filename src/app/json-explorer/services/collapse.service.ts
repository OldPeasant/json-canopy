import { Injectable, signal } from '@angular/core';

// Explicit per-node collapse/expand choices, keyed by a node's instance id
// (unlike orientation/hidden columns, which are keyed by structural path and
// shared across array rows). A missing entry means "no choice": the node
// follows the filter's default (see FilterService.collapsedByFilter).
// Reset whenever the search changes, so a new search starts from its own defaults.
@Injectable({ providedIn: 'root' })
export class CollapseService {
  private readonly overrides = signal<ReadonlyMap<string, boolean>>(new Map());

  get(id: string): boolean | undefined {
    return this.overrides().get(id);
  }

  set(id: string, collapsed: boolean): void {
    this.overrides.update(prev => new Map(prev).set(id, collapsed));
  }

  clear(): void {
    if (this.overrides().size) this.overrides.set(new Map());
  }
}
