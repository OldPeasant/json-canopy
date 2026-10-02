import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { DocsPanelComponent } from './docs-panel/docs-panel.component';
import { JsonFormComponent } from './json-form/json-form.component';
import { OutlineComponent } from './outline/outline.component';
import { JsonTableComponent } from './json-table/json-table.component';
import type { Layout } from './layout.util';
import { FilterMode, FilterService } from './services/filter.service';
import { EditModeService } from './services/edit-mode.service';
import { ColumnSyncService } from './services/column-sync.service';
import { PanelService } from './services/panel.service';
import { SchemaService } from './services/schema.service';

@Component({
  selector: 'app-json-explorer',
  standalone: true,
  imports: [JsonTableComponent, JsonFormComponent, DocsPanelComponent, OutlineComponent],
  templateUrl: './json-explorer.component.html',
  styleUrl: './json-explorer.component.css',
})
export class JsonExplorerComponent {
  // Orientation and hidden-column state (TableOrientationService /
  // NodeVisibilityService, both keyed by structural path) is intentionally
  // NOT reset when this changes: two different JSON documents that share a
  // shape (e.g. every llm_request's request.messages/request.tools) should
  // keep sharing the same view configuration instead of forgetting it.
  @Input({ required: true }) value: unknown;

  // Two renderings of the same document; the search works in both.
  @Input() layout: Layout = 'tables';

  // Bubbled up from the root `app-json-table` unchanged — `App` is the one
  // that owns the actual `data` signal and does `data.set($event)`.
  @Output() valueChange = new EventEmitter<unknown>();

  protected filter = inject(FilterService);
  protected editMode = inject(EditModeService);
  protected panels = inject(PanelService);
  protected schema = inject(SchemaService);
  private colSync = inject(ColumnSyncService);

  // Shown as buttons next to the search box, in this order.
  protected readonly filterModes: { value: FilterMode; label: string; hint: string }[] = [
    { value: 'strict', label: 'Strict', hint: 'Only what matched, under its dimmed parents. A matching name shows its value; a nested one collapsed.' },
    { value: 'context', label: 'Context', hint: 'Matches in full, with all their siblings; the siblings of every parent show collapsed. Click to expand, Shift+click to expand all alike.' },
  ];

  protected get modeHint(): string {
    return this.filterModes.find(m => m.value === this.filter.mode())!.hint;
  }

  onFilterInput(event: Event): void {
    this.filter.set((event.target as HTMLInputElement).value);
  }

  // Edit mode adds/removes per-cell controls (delete buttons, add-row
  // inputs) inside the very <th>/<td> elements ColumnSyncService measures,
  // so toggling it must re-run the sync the same way orientation changes do
  // — otherwise stale min-widths from the previous mode linger and columns
  // sharing a structural path (e.g. every "role" column) drift out of sync.
  toggleEditMode(): void {
    this.editMode.toggle();
    this.colSync.scheduleSync();
  }
}
