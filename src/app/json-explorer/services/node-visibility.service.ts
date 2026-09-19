import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class NodeVisibilityService {
  private readonly hiddenKeys = signal<ReadonlySet<string>>(new Set());

  isHidden(colKey: string): boolean {
    return this.hiddenKeys().has(colKey);
  }

  toggle(colKey: string): void {
    this.hiddenKeys.update(prev => {
      const next = new Set(prev);
      if (next.has(colKey)) {
        next.delete(colKey);
      } else {
        next.add(colKey);
      }
      return next;
    });
  }

  clear(): void {
    this.hiddenKeys.set(new Set());
  }
}
