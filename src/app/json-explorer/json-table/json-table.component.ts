import { Component, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { TableOrientationService } from '../services/table-orientation.service';
import { ColumnSyncService } from '../services/column-sync.service';
import { FilterService } from '../services/filter.service';
import { NodeVisibilityService } from '../services/node-visibility.service';
import { CollapseService } from '../services/collapse.service';
import { RevealService } from '../services/reveal.service';
import { ColumnMenuComponent } from '../column-menu/column-menu.component';
import { EditableValueComponent } from '../editable-value/editable-value.component';
import { HighlightComponent } from '../highlight/highlight.component';
import { EditModeService } from '../services/edit-mode.service';
import { estimateAvgItemBytes, initialRevealCount } from '../reveal.util';
import {
  JsonType,
  blankLike,
  typeOf,
  withAppended,
  withEntry,
  withItem,
  withoutEntry,
  withoutItemAt,
} from '../json-edit.util';

@Component({
  selector: 'app-json-table',
  standalone: true,
  imports: [JsonTableComponent, ColumnMenuComponent, EditableValueComponent, HighlightComponent],
  templateUrl: './json-table.component.html',
  styleUrl: './json-table.component.css',
})
export class JsonTableComponent implements OnInit {
  @Input({ required: true }) value!: unknown;
  @Input() path: string = '';
  // Set by a parent whose own key/value directly matched the filter (or was
  // itself forced) — every node below such a match stays visible, no matter
  // what it contains.
  @Input() forceVisible: boolean = false;
  // Instance id (unlike `path`, unique per array row) for collapse state.
  @Input() uid: string = '';
  // The filter's default for this node: show its key but keep the value
  // collapsed behind a click.
  @Input() filterCollapsed: boolean = false;

  // Emits the new value for THIS node — either a direct edit at this node
  // (leaf value or type switch, handled by onSelfChange) or a rebuilt
  // object/array with one child replaced (onEntryChange/onItemChange/etc).
  // No index-paths are needed: each level rebuilds only its own immediate
  // structure and re-emits, bubbling one level at a time up to `App`.
  @Output() valueChange = new EventEmitter<unknown>();

  private orientations = inject(TableOrientationService);
  private colSync = inject(ColumnSyncService);
  private visibility = inject(NodeVisibilityService);
  protected filter = inject(FilterService);
  protected editMode = inject(EditModeService);
  protected reveal = inject(RevealService);
  private collapse = inject(CollapseService);

  // Expanding a node by hand shows everything below it, whatever the filter
  // would otherwise hide there.
  private get effectiveForce(): boolean {
    return this.forceVisible || this.collapse.get(this.uid, this.path) === false;
  }

  get collapsed(): boolean {
    return this.collapse.get(this.uid, this.path) ?? this.filterCollapsed;
  }

  get isContainer(): boolean { return this.type === 'object' || this.type === 'array'; }

  private get hasContent(): boolean {
    if (this.type === 'object') return this.objEntries.length > 0;
    if (this.type === 'array') return this.arr.length > 0;
    return true;
  }

  // A collapsed node renders a clickable chip in place of its content.
  get showChip(): boolean { return this.collapsed && this.hasContent; }

  get chipLabel(): string {
    if (this.type === 'object') return `{ ${this.objEntries.length} }`;
    if (this.type === 'array') return `[ ${this.arr.length} ]`;
    return '…';
  }

  setCollapsed(event: Event, collapsed: boolean): void {
    event.stopPropagation();
    // Shift-click applies to every related node (same structural path).
    this.collapse.set(this.uid, this.path, collapsed, (event as MouseEvent).shiftKey);
    this.colSync.scheduleSync();
  }

  get orientation(): 'h' | 'v' { return this.orientations.read(this.path); }

  get type(): JsonType { return typeOf(this.value); }

  // --- object helpers ---
  get objEntries(): [string, unknown][] {
    return Object.entries(this.value as Record<string, unknown>);
  }
  get objKeys(): string[] {
    return Object.keys(this.value as Record<string, unknown>);
  }

  // In 'context' mode, a direct match among this object's own entries widens
  // visibility to every entry here — showing the whole record around the match.
  private get objGroupMatch(): boolean {
    return this.filter.groupMatch(this.objEntries);
  }

  get filteredObjEntries(): [string, unknown][] {
    const widened = this.objGroupMatch;
    return this.objEntries.filter(([k, v]) => this.entryVisible(k, v, widened));
  }

  // Post-filter AND post-reveal: only the currently-revealed slice of
  // whatever the filter left visible. Filtering happens first (above) so a
  // search never gets hidden behind an unrelated reveal boundary — if a
  // filter narrows this down to 3 entries, revealedCount clamps to 3 (see
  // RevealService.count), so all 3 show regardless of the byte-budget slice.
  get visibleObjEntries(): [string, unknown][] {
    return this.filteredObjEntries.slice(0, this.revealedCount);
  }

  get visibleObjKeys(): string[] {
    return this.visibleObjEntries.map(([k]) => k);
  }

  // --- array helpers ---
  get arr(): unknown[] { return this.value as unknown[]; }

  isObjectItem(item: unknown): boolean {
    return typeOf(item) === 'object' && item !== null;
  }

  // Columnar (keyed) layout kicks in as soon as ANY item is an object, not
  // only when every item is — a non-object item (e.g. one stray string
  // appended to an otherwise uniform array of records) still gets its own
  // row/column via the synthetic "value" slot below, instead of knocking
  // the whole array back to the plain, unkeyed item list.
  get isArrayOfObjects(): boolean {
    const a = this.arr;
    return a.length > 0 && a.some(item => this.isObjectItem(item));
  }

  get arrayKeys(): string[] {
    const seen = new Set<string>();
    const keys: string[] = [];
    for (const item of this.arr) {
      if (!this.isObjectItem(item)) continue;
      for (const k of Object.keys(item as Record<string, unknown>)) {
        if (!seen.has(k)) { seen.add(k); keys.push(k); }
      }
    }
    return keys;
  }

  // Whether the synthetic "value" column/row is needed at all — only when
  // at least one item isn't a plain object and therefore has no keys of its
  // own to line up with the shared column set.
  get hasNonObjectItems(): boolean {
    return this.arr.some(item => !this.isObjectItem(item));
  }

  // Whether the row at this item is itself a "widened" group in 'context'
  // mode — i.e. one of its own cells matched, so every other cell in the row
  // should show too, to render the full record.
  rowGroupMatch(item: unknown): boolean {
    return this.isObjectItem(item) && this.filter.groupMatch(this.objEntriesOf(item));
  }

  private objEntriesOf(item: unknown): [string, unknown][] {
    return Object.entries(item as Record<string, unknown>);
  }

  // A column is shown if it isn't manually hidden via the column menu, and
  // either the column name itself matches, or at least one row has a
  // matching (or match-containing) value in that column, or the row is
  // itself a widened group that needs every cell shown.
  get visibleArrayKeys(): string[] {
    return this.arrayKeys.filter(k => {
      if (this.visibility.isHidden(this.colKey(k))) return false;
      if (this.effectiveForce || this.filter.directMatch(k, undefined)) return true;
      return this.arr.some(item => {
        if (!this.hasCell(item, k)) return false;
        return this.filter.treeMatch(k, this.cell(item, k)) || this.rowGroupMatch(item);
      });
    });
  }

  // Rows (or, transposed, the item-columns) are shown if forced, or if they
  // have a match somewhere among the currently-visible columns. Indices (not
  // items) are exposed so the original #N position can still be displayed.
  get filteredArrayIndices(): number[] {
    const keys = this.visibleArrayKeys;
    return this.arr
      .map((_, i) => i)
      .filter(i => {
        if (this.effectiveForce) return true;
        const item = this.arr[i];
        if (!this.isObjectItem(item)) return this.filter.treeMatch(null, item);
        return keys.some(k => this.hasCell(item, k) && this.filter.treeMatch(k, this.cell(item, k)));
      });
  }

  // See visibleObjEntries above for why filtering happens before slicing.
  get visibleArrayIndices(): number[] {
    return this.filteredArrayIndices.slice(0, this.revealedCount);
  }

  // Indices of the shown plain (non-object) array items. Indices (not
  // items) are exposed so edits/deletes can address the real position in
  // `arr`, independent of which items the filter currently hides.
  get filteredArrItemIndices(): number[] {
    if (this.effectiveForce) return this.arr.map((_, i) => i);
    return this.arr.map((_, i) => i).filter(i => this.filter.treeMatch(null, this.arr[i]));
  }

  get visibleArrItemIndices(): number[] {
    return this.filteredArrItemIndices.slice(0, this.revealedCount);
  }

  // --- reveal (pagination) helpers ---
  // Exactly one of these three "filtered length" sources is ever relevant
  // for a given component instance, decided structurally by type/shape —
  // never both at once — so it's safe for revealedCount/hasMoreItems/etc.
  // to be generic across all three without the caller specifying which.
  private get currentFilteredLength(): number {
    if (this.type === 'object') return this.filteredObjEntries.length;
    if (this.isArrayOfObjects) return this.filteredArrayIndices.length;
    return this.filteredArrItemIndices.length;
  }

  private get currentAvgItemBytes(): number {
    if (this.type === 'object') {
      return estimateAvgItemBytes(this.value as object, this.objEntries.map(([, v]) => v));
    }
    return estimateAvgItemBytes(this.arr, this.arr);
  }

  get revealedCount(): number {
    const filteredLength = this.currentFilteredLength;
    const initial = initialRevealCount(filteredLength, this.currentAvgItemBytes);
    return this.reveal.count(this.path, filteredLength, initial);
  }

  get hasMoreItems(): boolean {
    return this.revealedCount < this.currentFilteredLength;
  }

  get totalFilteredCount(): number {
    return this.currentFilteredLength;
  }

  revealMoreItems(by: number): void {
    this.reveal.revealMore(this.path, by, this.currentFilteredLength);
  }

  revealAllItems(): void {
    this.reveal.revealAll(this.path, this.currentFilteredLength);
  }

  itemForceVisible(item: unknown): boolean {
    return this.effectiveForce || this.filter.forces(null, item);
  }

  // In 'context' mode a matching node shows its whole subtree, and so do the
  // siblings of a matching node (groupMatch) — bounded to the matching
  // group, so an ancestor that merely contains a match never forces the
  // whole document.
  cellForceVisible(item: unknown, key: string): boolean {
    return this.effectiveForce
      || this.filter.forces(key, this.cell(item, key))
      || this.filter.groupMatch(this.objEntriesOf(item));
  }

  // An object entry is shown if it isn't manually hidden via the column menu
  // and it (or something in its subtree) matches the filter, or an ancestor
  // already matched and forced everything below it visible, or the current
  // mode has widened visibility to the whole group this entry belongs to.
  private entryVisible(key: string, value: unknown, widened: boolean): boolean {
    if (this.visibility.isHidden(this.colKey(key))) return false;
    return this.effectiveForce || widened || this.filter.treeMatch(key, value);
  }

  entryForceVisible(key: string, value: unknown): boolean {
    return this.effectiveForce
      || this.filter.forces(key, value)
      || this.filter.groupMatch(this.objEntries);
  }

  entryCollapsed(key: string, value: unknown): boolean {
    return !this.entryForceVisible(key, value) && this.filter.collapsedByFilter(key, value);
  }

  cellCollapsed(item: unknown, key: string): boolean {
    const value = this.cell(item, key);
    return !this.cellForceVisible(item, key) && this.filter.collapsedByFilter(key, value);
  }

  objDim(key: string): boolean {
    return this.filter.keyDim(key, (this.value as Record<string, unknown>)[key]);
  }

  columnDim(key: string): boolean {
    if (!this.filter.active) return false;
    switch (this.filter.mode()) {
      case 'matches': return !this.filter.keyMatch(key);
      case 'context':
        return !this.arr.some(item => this.hasCell(item, key) && this.filter.treeMatch(key, this.cell(item, key)));
      default: return false;
    }
  }

  cell(item: unknown, key: string): unknown {
    return (item as Record<string, unknown>)[key];
  }

  hasCell(item: unknown, key: string): boolean {
    return this.isObjectItem(item) && Object.prototype.hasOwnProperty.call(item, key);
  }

  // --- child path builders ---
  objChildPath(key: string): string {
    return this.path ? `${this.path}.${key}` : key;
  }

  arrCellPath(key: string): string {
    return this.path ? `${this.path}.*.${key}` : `*.${key}`;
  }

  objChildUid(key: string): string { return `${this.uid}.${key}`; }
  cellUid(index: number, key: string): string { return `${this.uid}[${index}].${key}`; }
  itemUid(index: number): string { return `${this.uid}[${index}]`; }

  arrItemPath(): string {
    return this.path ? `${this.path}.*` : '*';
  }

  // data-col-key value: structural-path + column key, used by ColumnSyncService
  colKey(columnKey: string): string {
    return `${this.path}:${columnKey}`;
  }

  ngOnInit(): void {
    // Schedule after the full component tree is rendered, not just this node.
    this.colSync.scheduleSync();
  }

  toggle(event: Event): void {
    event.stopPropagation();
    this.orientations.toggle(this.path);
    this.colSync.scheduleSync();
  }

  // --- edits at this node itself (leaf edit, or a type switch from the
  // `<app-editable-value>` shown for any value, primitive or container) ---
  onSelfChange(newValue: unknown): void {
    this.valueChange.emit(newValue);
  }

  // --- object mutation ---
  onEntryChange(key: string, newValue: unknown): void {
    this.valueChange.emit(withEntry(this.value as Record<string, unknown>, key, newValue));
  }

  onEntryDelete(key: string): void {
    this.valueChange.emit(withoutEntry(this.value as Record<string, unknown>, key));
  }

  addEntry(key: string): void {
    const trimmed = key.trim();
    if (!trimmed) return;
    const obj = this.value as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(obj, trimmed)) return;
    this.valueChange.emit(withEntry(obj, trimmed, ''));
  }

  // --- array mutation (plain items and array-of-objects items alike) ---
  onItemChange(index: number, newValue: unknown): void {
    this.valueChange.emit(withItem(this.arr, index, newValue));
  }

  onItemDelete(index: number): void {
    this.valueChange.emit(withoutItemAt(this.arr, index));
  }

  addItem(): void {
    this.valueChange.emit(withAppended(this.arr, ''));
  }

  // --- array-of-objects cell mutation: edits/deletes one key within one
  // row's object, leaving every other row untouched ---
  onCellChange(index: number, key: string, newValue: unknown): void {
    const item = this.arr[index] as Record<string, unknown>;
    this.onItemChange(index, withEntry(item, key, newValue));
  }

  onCellDelete(index: number, key: string): void {
    const item = this.arr[index] as Record<string, unknown>;
    this.onItemChange(index, withoutEntry(item, key));
  }

  // Fills in a row's missing cell for a shared column, shaped like whatever
  // another row already has there (same keys/array length, leaves blanked)
  // rather than a bare empty string — so e.g. adding "contact" on a row that
  // lacks it starts you with the same { email, phone } shape other rows use.
  addCellLike(index: number, key: string): void {
    const source = this.arr.find(item => this.hasCell(item, key));
    const template = source === undefined ? '' : blankLike(this.cell(source, key));
    this.onCellChange(index, key, template);
  }
}
