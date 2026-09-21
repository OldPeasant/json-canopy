import { Component, Input } from '@angular/core';
import type { NodeMeta } from '../../schema';

// What the schema says about one node — title, type, description, constraints,
// default, examples — as a block. Shared by the ⓘ popover and the docs panel,
// so the two never disagree about how documentation reads.
@Component({
  selector: 'app-schema-doc',
  standalone: true,
  templateUrl: './schema-doc.component.html',
  styleUrl: './schema-doc.component.css',
})
export class SchemaDocComponent {
  @Input({ required: true }) meta!: NodeMeta;
  // Whether the parent requires this key (the node's own schema cannot say).
  @Input() required = false;

  json(value: unknown): string {
    return JSON.stringify(value);
  }
}
