import { Component, Input, inject } from '@angular/core';
import { FocusService } from '../services/focus.service';
import { JumpService } from '../services/jump.service';
import { SchemaService } from '../services/schema.service';
import { OutlineRow, outlineRows } from './outline.util';

// The document's structure as a list to navigate by: click a group and the
// form scrolls to it, opening whatever hides it. Problems are counted on the
// rows, so it doubles as a map of where the errors are.
@Component({
  selector: 'app-outline',
  standalone: true,
  templateUrl: './outline.component.html',
  styleUrl: './outline.component.css',
})
export class OutlineComponent {
  @Input({ required: true }) value: unknown;

  private jump = inject(JumpService);
  private focus = inject(FocusService);
  private schema = inject(SchemaService);

  private memo?: { value: unknown; index: unknown; rows: OutlineRow[] };

  // Rebuilt when the document or its problems change, not on every pass.
  get rows(): OutlineRow[] {
    const index = this.schema.index();
    const memo = this.memo;
    if (memo && memo.value === this.value && memo.index === index) return memo.rows;
    const rows = outlineRows(this.value, index);
    this.memo = { value: this.value, index, rows };
    return rows;
  }

  isCurrent(row: OutlineRow): boolean {
    return this.focus.key() === row.key;
  }

  go(row: OutlineRow): void {
    if (row.kind !== 'more') this.jump.toPath(row.path, this.value);
  }
}
