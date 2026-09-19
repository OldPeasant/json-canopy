import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ColumnSyncService {
  private pending = false;

  scheduleSync(): void {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.sync();
    });
  }

  private sync(): void {
    const ths = document.querySelectorAll<HTMLElement>('[data-col-key]');
    if (!ths.length) return;

    // Reset all min-widths so we measure natural content sizes.
    ths.forEach(th => { th.style.minWidth = ''; });

    // Reading offsetWidth forces a synchronous reflow.
    // Separate the read pass from the write pass to avoid layout thrashing.
    const maxes = new Map<string, number>();
    ths.forEach(th => {
      const k = th.dataset['colKey']!;
      const w = th.offsetWidth;
      if (w > (maxes.get(k) ?? 0)) maxes.set(k, w);
    });

    ths.forEach(th => {
      th.style.minWidth = (maxes.get(th.dataset['colKey']!) ?? 0) + 'px';
    });
  }
}
