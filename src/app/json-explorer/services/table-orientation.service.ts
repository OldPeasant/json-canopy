import { Injectable, signal, WritableSignal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class TableOrientationService {
  private readonly signals = new Map<string, WritableSignal<'h' | 'v'>>();

  private getOrCreate(path: string): WritableSignal<'h' | 'v'> {
    let sig = this.signals.get(path);
    if (!sig) {
      sig = signal<'h' | 'v'>('v');
      this.signals.set(path, sig);
    }
    return sig;
  }

  // Reading the signal in a template reactive context causes Angular to
  // track it — only components sharing the same path re-render on toggle.
  read(path: string): 'h' | 'v' {
    return this.getOrCreate(path)();
  }

  toggle(path: string): void {
    this.getOrCreate(path).update(v => (v === 'h' ? 'v' : 'h'));
  }

  clear(): void {
    this.signals.clear();
  }
}
