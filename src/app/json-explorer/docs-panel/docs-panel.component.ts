import { Component, inject } from '@angular/core';
import { formatPath, parsePathKey, pathKey, type NodeMeta, type Problem } from '../../schema';
import { SchemaDocComponent } from '../schema-doc/schema-doc.component';
import { FocusService } from '../services/focus.service';
import { SchemaService } from '../services/schema.service';

// A side panel that shows what the schema says about the field in focus —
// the same documentation as the ⓘ popover, but always there, with the
// problems of that field beneath it.
@Component({
  selector: 'app-docs-panel',
  standalone: true,
  imports: [SchemaDocComponent],
  templateUrl: './docs-panel.component.html',
  styleUrl: './docs-panel.component.css',
})
export class DocsPanelComponent {
  private focus = inject(FocusService);
  private schema = inject(SchemaService);

  get key(): string | undefined { return this.focus.key(); }

  get path(): string {
    return this.key === undefined ? '' : formatPath(parsePathKey(this.key));
  }

  get meta(): NodeMeta | undefined {
    return this.key === undefined ? undefined : this.schema.metaFor(this.key);
  }

  // Whether the parent object requires this key.
  get required(): boolean {
    if (this.key === undefined) return false;
    const path = parsePathKey(this.key);
    const last = path[path.length - 1];
    return typeof last === 'string' && this.schema.requiredFor(pathKey(path.slice(0, -1))).has(last);
  }

  get problems(): readonly Problem[] {
    return this.key === undefined ? [] : this.schema.index().at(this.key);
  }

  get below(): number {
    return this.key === undefined ? 0 : this.schema.index().countBelow(this.key);
  }
}
