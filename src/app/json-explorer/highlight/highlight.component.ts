import { Component, Input, inject } from '@angular/core';
import { FilterService } from '../services/filter.service';

// Renders text with the current search term marked.
@Component({
  selector: 'app-hl',
  standalone: true,
  template: `@for (p of parts; track $index) {@if (p.hit) {<mark>{{ p.t }}</mark>} @else {<span>{{ p.t }}</span>}}`,
  styles: [
    `
      :host { display: contents; }
      mark {
        background: var(--accent-soft);
        color: inherit;
        border-radius: 2px;
        outline: 1px solid var(--accent);
      }
    `,
  ],
})
export class HighlightComponent {
  @Input({ required: true }) text!: string;
  @Input() kind: 'key' | 'value' = 'value';

  private filter = inject(FilterService);

  get parts(): Array<{ t: string; hit: boolean }> {
    // Reads the signal so the view refreshes when the search changes.
    this.filter.text();
    this.filter.keysOnly();
    return this.filter.highlight(this.text, this.kind === 'key');
  }
}
