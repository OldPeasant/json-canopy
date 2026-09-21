import { Component, Input, inject } from '@angular/core';
import type { NodeMeta } from '../../schema';
import { SchemaService } from '../services/schema.service';

// An ⓘ next to a key that shows what the schema says about it — description,
// constraints, default, examples — in a small panel on hover or keyboard
// focus. Renders nothing when the schema has nothing to add to the key.
@Component({
  selector: 'app-schema-info',
  standalone: true,
  templateUrl: './schema-info.component.html',
  styleUrl: './schema-info.component.css',
})
export class SchemaInfoComponent {
  // Instance key of the node this describes (the same `uid` the table uses).
  @Input({ required: true }) nodeKey!: string;
  // Ask across all variants instead of the one the current data selects — for
  // a column that stands for many rows.
  @Input() wide = false;

  private schema = inject(SchemaService);

  protected open = false;
  protected x = 0;
  protected y = 0;

  private static readonly PANEL_WIDTH = 384;

  get meta(): NodeMeta | undefined {
    const m = this.schema.metaFor(this.nodeKey, !this.wide);
    return m && this.worthShowing(m) ? m : undefined;
  }

  // The bare type is not worth an icon on every key; anything else is.
  private worthShowing(m: NodeMeta): boolean {
    return !!(m.title || m.description || m.examples?.length || m.hasDefault || m.constraints.length || m.deprecated || m.readOnly);
  }

  show(event: Event): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.x = Math.max(8, Math.min(rect.left, window.innerWidth - SchemaInfoComponent.PANEL_WIDTH - 8));
    this.y = rect.bottom + 4;
    this.open = true;
  }

  hide(): void {
    this.open = false;
  }

  json(value: unknown): string {
    return JSON.stringify(value);
  }
}
