import { Injectable, signal } from '@angular/core';

// Which side panels of the form layout are open.
@Injectable({ providedIn: 'root' })
export class PanelService {
  readonly docsOpen = signal(true);
  readonly outlineOpen = signal(false);

  toggleDocs(): void { this.docsOpen.update(v => !v); }
  toggleOutline(): void { this.outlineOpen.update(v => !v); }
}
