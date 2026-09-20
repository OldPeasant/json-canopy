import { Injectable, signal } from '@angular/core';

interface Choice {
  collapsed: boolean;
  path: string;
}

// Explicit collapse/expand choices. A choice applies either to one node
// (keyed by instance id, unique per array row) or to every "related" node
// sharing a structural path — e.g. the same column in every row of an array,
// the same notion the orientation toggle uses. A choice for one node wins
// over a path-wide one. A missing choice means the node follows the filter's
// default (see FilterService.collapsedByFilter). All choices are reset when
// the search changes, so a new search starts from its own defaults.
@Injectable({ providedIn: 'root' })
export class CollapseService {
  private readonly byNode = signal<ReadonlyMap<string, Choice>>(new Map());
  private readonly byPath = signal<ReadonlyMap<string, boolean>>(new Map());

  get(id: string, path: string): boolean | undefined {
    return this.byNode().get(id)?.collapsed ?? this.byPath().get(path);
  }

  set(id: string, path: string, collapsed: boolean, related: boolean): void {
    if (!related) {
      this.byNode.update(prev => new Map(prev).set(id, { collapsed, path }));
      return;
    }
    this.byPath.update(prev => new Map(prev).set(path, collapsed));
    // Drop single-node choices the path-wide one now supersedes.
    this.byNode.update(prev => new Map([...prev].filter(([, c]) => c.path !== path)));
  }

  clear(): void {
    if (this.byNode().size) this.byNode.set(new Map());
    if (this.byPath().size) this.byPath.set(new Map());
  }
}
