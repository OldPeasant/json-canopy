import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { JsonTableComponent } from './json-table/json-table.component';
import { FilterMode, FilterService } from './services/filter.service';
import { EditModeService } from './services/edit-mode.service';
import { ColumnSyncService } from './services/column-sync.service';

@Component({
  selector: 'app-json-explorer',
  standalone: true,
  imports: [JsonTableComponent],
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

  // Bubbled up from the root `app-json-table` unchanged — `App` is the one
  // that owns the actual `data` signal and does `data.set($event)`.
  @Output() valueChange = new EventEmitter<unknown>();

  protected filter = inject(FilterService);
  protected editMode = inject(EditModeService);
  private colSync = inject(ColumnSyncService);

  // Shown as buttons next to the search box, in this order.
  protected readonly filterModes: { value: FilterMode; label: string; hint: string }[] = [
    { value: 'value', label: 'Any', hint: 'Match key or value text; show only the path to each match.' },
    { value: 'field', label: 'Fields', hint: "Match key names only (e.g. \"description\"); show only the path to each match." },
    { value: 'object', label: 'Object', hint: 'Match key or value text; show the whole object containing each match.' },
    { value: 'context', label: 'Context', hint: "Match key or value text; show the whole matching object (siblings with all sub-nodes) plus every ancestor's siblings." },
  ];

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
