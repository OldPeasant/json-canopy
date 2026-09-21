import { Injectable, inject, signal } from '@angular/core';
import { Layout, defaultLayout } from '../layout.util';
import { FilterService } from './filter.service';

// Which of the two renderings of the same document is showing. The user's
// own choice always wins; until they make one, the layout follows the
// document and whether it has a schema (see defaultLayout).
@Injectable({ providedIn: 'root' })
export class LayoutService {
  private readonly _mode = signal<Layout>('tables');
  private filter = inject(FilterService);
  private chosen = false;

  readonly mode = this._mode.asReadonly();

  choose(mode: Layout): void {
    // The form has no search box, so a search left over from the tables
    // would go on hiding things in the tables it embeds with no way to clear it.
    if (mode === 'form') this.filter.clear();
    this.chosen = true;
    this._mode.set(mode);
  }

  // Re-evaluates the default, unless the user has chosen for this document.
  suggest(data: unknown, hasSchema: boolean): void {
    if (!this.chosen) this._mode.set(defaultLayout(data, hasSchema));
  }

  // A new document starts without the previous one's choice.
  reset(): void {
    this.chosen = false;
  }
}
