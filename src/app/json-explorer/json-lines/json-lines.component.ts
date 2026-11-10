import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { HighlightComponent } from '../highlight/highlight.component';
import { JsonFormComponent } from '../json-form/json-form.component';
import { JsonTableComponent } from '../json-table/json-table.component';
import { groupRootPath, lineUid, type JsonLine } from '../json-lines.util';
import type { Layout } from '../layout.util';
import { FilterService } from '../services/filter.service';
import { JsonLinesService, LINES_INITIAL_COUNT, LINES_REVEAL_KEY } from '../services/json-lines.service';
import { RevealService } from '../services/reveal.service';
import { SchemaService } from '../services/schema.service';

// A JSON Lines file: each line shown the way a whole document is, one below
// the other; a line that is not JSON as its text, in a single cell. Lines of
// alike shape share a structural root path (see groupRootPath), so turning a
// table, hiding a column or collapsing related nodes in one does the same in
// the others of its group, and in no other line.
@Component({
  selector: 'app-json-lines',
  standalone: true,
  imports: [JsonTableComponent, JsonFormComponent, HighlightComponent],
  templateUrl: './json-lines.component.html',
  styleUrl: './json-lines.component.css',
})
export class JsonLinesComponent {
  @Input() layout: Layout = 'tables';

  @Output() lineChange = new EventEmitter<{ index: number; value: unknown }>();

  protected lines = inject(JsonLinesService);
  protected filter = inject(FilterService);
  protected reveal = inject(RevealService);
  private schema = inject(SchemaService);

  protected readonly groupRootPath = groupRootPath;
  protected readonly lineUid = lineUid;

  get doc() { return this.lines.doc()!; }

  // Shown lines the search leaves: those with a match somewhere in them.
  get matching(): number[] {
    const shown = this.lines.shown();
    if (!this.filter.active) return shown;
    const lines = this.doc.lines;
    return shown.filter(i => this.matches(lines[i]));
  }

  private matches(line: JsonLine): boolean {
    return line.kind === 'json' ? this.filter.treeMatch(null, line.value) : this.filter.valueMatch(line.text);
  }

  get revealedCount(): number {
    const length = this.matching.length;
    return this.reveal.count(LINES_REVEAL_KEY, length, Math.min(length, LINES_INITIAL_COUNT));
  }

  get paged(): number[] {
    return this.matching.slice(0, this.revealedCount);
  }

  get hasMore(): boolean { return this.revealedCount < this.matching.length; }

  revealMore(by: number): void { this.reveal.revealMore(LINES_REVEAL_KEY, by); }

  revealAll(): void { this.reveal.revealAll(LINES_REVEAL_KEY); }

  // A letter per group of alike lines, shown only when there is more than one.
  groupLabel(line: JsonLine): string | undefined {
    if (line.kind !== 'json' || this.doc.groupCount < 2) return undefined;
    return groupName(line.group);
  }

  // Everything wrong in the line: the problem list and the badges inside say what.
  problemCount(line: number): number {
    const index = this.schema.index();
    const uid = lineUid(line);
    return index.at(uid).length + index.countBelow(uid);
  }
}

// A, B, ... Z, AA, AB, ...
function groupName(group: number): string {
  let name = '';
  for (let n = group + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}
