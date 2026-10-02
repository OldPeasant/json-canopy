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

  private extra(path: string): WritableSignal<number> {
    let sig = this.signals.get(path);
    if (!sig) {
      sig = signal(0);
      this.signals.set(path, sig);
    }
    return sig;
  }

  // The signal holds how many items the user revealed *beyond* the usual
  // first page, never an absolute count. `initial` is recomputed from the
  // current (post-filter) length on every read, so an array first drawn
  // while a search showed only 2 of its 3 items isn't stuck at 2 once the
  // search changes or is cleared. Clamping to `filteredLength` on read means
  // a filter that shrinks the visible set doesn't lose the user's "revealed
  // more" progress if they clear the filter again.
  count(path: string, filteredLength: number, initial: number): number {
    return Math.min(initial + this.extra(path)(), filteredLength);
  }

  revealMore(path: string, by: number): void {
    this.extra(path).update(n => n + by);
  }

  // Makes sure the child at `position` is among the revealed ones, growing
  // the count only as far as that, so a jump to an early item leaves the
  // usual first page as it was.
  ensure(path: string, position: number, initial: number): void {
    const sig = this.extra(path);
    sig.set(Math.max(sig(), position + 1 - initial));
  }

  revealAll(path: string): void {
    this.extra(path).set(Infinity);
  }

  clear(): void {
    this.signals.clear();
  }
}
