import { Injectable, signal, WritableSignal } from '@angular/core';
import { REVEAL_BATCHES } from '../reveal.util';

// How many items of a large array/object (keyed by structural path, same
// convention as TableOrientationService) are currently revealed. Unlike
// orientation/hidden-column state, this is meant to be reset per document
// (see App.parse()'s call to `reveal.clear()`) — a reveal count describes
// this document's array sizes, not a view preference worth carrying over
// to the next file opened.
@Injectable({ providedIn: 'root' })
export class RevealService {
  private readonly signals = new Map<string, WritableSignal<number>>();

  readonly batches = REVEAL_BATCHES;

  private getOrCreate(path: string, initial: number): WritableSignal<number> {
    let sig = this.signals.get(path);
    if (!sig) {
      sig = signal(initial);
      this.signals.set(path, sig);
    }
    return sig;
  }

  // `initial` (the byte-budget-derived starting count from reveal.util.ts)
  // only takes effect the first time this path is seen; after that, the
  // signal's own value — grown via revealMore/revealAll — is authoritative.
  // Clamping to `filteredLength` here (rather than when storing) means a
  // filter that later shrinks the visible set doesn't lose the user's
  // "revealed more" progress if they clear the filter again.
  count(path: string, filteredLength: number, initial: number): number {
    return Math.min(this.getOrCreate(path, initial)(), filteredLength);
  }

  hasMore(path: string, filteredLength: number, initial: number): boolean {
    return this.count(path, filteredLength, initial) < filteredLength;
  }

  revealMore(path: string, by: number, filteredLength: number): void {
    this.getOrCreate(path, 0).update(n => Math.min(filteredLength, n + by));
  }

  revealAll(path: string, filteredLength: number): void {
    this.getOrCreate(path, 0).set(filteredLength);
  }

  clear(): void {
    this.signals.clear();
  }
}
