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
import { SchemaInfoComponent } from '../schema-info/schema-info.component';
import { EditModeService } from '../services/edit-mode.service';
import { SchemaService } from '../services/schema.service';
import { appendKey, type GhostKey, type Problem } from '../../schema';
import { estimateAvgItemBytes, initialRevealCount } from '../reveal.util';
import {
  JsonType,
  blankItemLike,
  blankLike,
  typeOf,
  withAppended,
  withEntry,
  withItem,
  withoutEntry,
  withoutItemAt,
} from '../json-edit.util';

const NO_KEYS: readonly string[] = [];

@Component({
  selector: 'app-json-table',
  standalone: true,
  imports: [JsonTableComponent, ColumnMenuComponent, EditableValueComponent, HighlightComponent, SchemaInfoComponent],
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
  private schema = inject(SchemaService);

  // Expanding a node by hand shows everything below it, whatever the filter
  // would otherwise hide there.
  private get effectiveForce(): boolean {
    return this.forceVisible || this.collapse.get(this.uid, this.path) === false;
  }

  get collapsed(): boolean {
    return this.collapse.get(this.uid, this.path) ?? this.filterCollapsed;
  }

  protected readonly GHOST_COLUMN_TITLE = 'Declared by the schema; no row has it yet';

  // A key the schema marks deprecated is struck through in its header. A
  // column shared by many rows asks across all variants (narrow = false).
  isDeprecated(childKey: string, narrow = true): boolean {
    return this.schema.metaFor(childKey, narrow)?.deprecated === true;
  }

  columnUid(key: string): string { return appendKey(this.itemUid(0), key); }

  // Edit controls at this node: on in edit mode, unless the schema makes the
  // node (or something above it) read-only.
  get canEdit(): boolean {
    return this.editMode.enabled() && !this.schema.readOnlyFor(this.uid);
  }

  // Schema problems about this very node — or, for something the data lacks
  // (a missing required key), about the nearest node that exists.
  get problems(): readonly Problem[] { return this.schema.index().at(this.uid); }

  get problemTitle(): string { return this.problems.map(p => p.message).join('\n'); }

  // In a table of records a row is not a node of its own — only its cells
  // are — so problems about the row itself (a missing required key) are
  // shown in the row's first cell (horizontal) or its #n header (vertical).
  rowProblemTitle(index: number): string {
    return this.schema.index().at(this.itemUid(index)).map(p => p.message).join('\n');
  }

  // Everything wrong at or below this node — what a collapsed chip is hiding.
  get chipProblemCount(): number {
    const index = this.schema.index();
    return index.at(this.uid).length + index.countBelow(this.uid);
  }

  // Declared keys this object does not have yet, offered in edit mode as
  // chips that add the key with a schema-shaped starting value.
  get ghosts(): readonly GhostKey[] {
    return this.type === 'object' && this.canEdit ? this.schema.ghostsFor(this.uid) : [];
  }

  ghostTitle(g: GhostKey): string {
    const parts = [g.schema.description ?? (g.required ? 'Required by the schema' : 'Optional key from the schema')];
    if (g.hasDefault) parts.push(`Default: ${JSON.stringify(g.default)}`);
    if (g.schema.readOnly) parts.push('Read-only');
    return parts.join('\n');
  }

  addGhost(g: GhostKey): void {
    const obj = this.value as Record<string, unknown>;
    this.valueChange.emit(withEntry(obj, g.key, this.schema.seed(g.schema)));
    // See addItem's comment: keeps a fully-shown object fully shown.
    this.reveal.revealMore(this.path, 1);
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

  get filteredObjEntries(): [string, unknown][] {
    // In 'context' mode, an object on the way to a match shows every entry.
    const widened = this.filter.widens(this.objEntries);
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

  // Shared column set: every key any row has, then — in edit mode, with a
  // schema — the keys the schema declares that no row has yet ("ghost"
  // columns, whose empty cells offer a + to add the key to that row).
  // Memoised on the array itself, which edits replace rather than mutate.
  private get keyInfo(): { arr: unknown[]; declared: readonly string[]; all: string[]; ghosts: Set<string> } {
    const arr = this.arr;
    const declared = this.canEdit ? this.schema.declaredItemKeys(this.uid) : NO_KEYS;
    const memo = this.keyMemo;
    if (memo && memo.arr === arr && memo.declared === declared) return memo;
    const seen = new Set<string>();
    const all: string[] = [];
    for (const item of arr) {
      if (!this.isObjectItem(item)) continue;
      for (const k of Object.keys(item as Record<string, unknown>)) {
        if (!seen.has(k)) { seen.add(k); all.push(k); }
      }
    }
    const ghosts = new Set(declared.filter(k => !seen.has(k)));
    all.push(...ghosts);
    return (this.keyMemo = { arr, declared, all, ghosts });
  }
  private keyMemo?: { arr: unknown[]; declared: readonly string[]; all: string[]; ghosts: Set<string> };

  get arrayKeys(): string[] { return this.keyInfo.all; }

  isGhostColumn(key: string): boolean { return this.keyInfo.ghosts.has(key); }

  // Whether a row may get this key at all: a closed object, or a variant that
  // doesn't declare it, must not be offered a + for it.
  canAddCell(index: number, key: string): boolean {
    return this.schema.permitsKey(this.itemUid(index), key);
  }

  // Whether the synthetic "value" column/row is needed at all — only when
  // at least one item isn't a plain object and therefore has no keys of its
  // own to line up with the shared column set.
  get hasNonObjectItems(): boolean {
    return this.arr.some(item => !this.isObjectItem(item));
  }

  // Whether the row at this item shows all its cells in 'context' mode: it
  // is on the way to a match, so every other cell in the row shows too.
  private rowWidened(item: unknown): boolean {
    return this.isObjectItem(item) && this.filter.widens(this.objEntriesOf(item));
  }

  // Everything in this array shows in full: expanded by hand, or ('context'
  // mode) one of its items matched directly, making all items its siblings.
  // Memoised, as it is asked once per item.
  private get arrForce(): boolean {
    if (this.effectiveForce) return true;
    const key = { arr: this.arr, text: this.filter.text(), mode: this.filter.mode() };
    const memo = this.arrForceMemo;
    if (memo && memo.arr === key.arr && memo.text === key.text && memo.mode === key.mode) return memo.force;
    const force = this.filter.groupMatch(this.arr.map(item => [null, item]));
    this.arrForceMemo = { ...key, force };
    return force;
  }
  private arrForceMemo?: { arr: unknown[]; text: string; mode: string; force: boolean };

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
      if (this.arrForce || this.filter.directMatch(k, undefined)) return true;
      return this.arr.some(item => {
        if (!this.hasCell(item, k)) return false;
        return this.filter.treeMatch(k, this.cell(item, k)) || this.rowWidened(item);
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
        if (this.arrForce) return true;
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
    if (this.arrForce) return this.arr.map((_, i) => i);
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
    this.reveal.revealMore(this.path, by);
  }

  revealAllItems(): void {
    this.reveal.revealAll(this.path);
  }

  itemForceVisible(item: unknown): boolean {
    return this.arrForce || this.filter.forces(null, item);
  }

  // In 'context' mode a matching node shows its whole subtree, and so do the
  // siblings of a matching node (groupMatch) — bounded to the matching
  // group, so an ancestor that merely contains a match never forces the
  // whole document.
  cellForceVisible(item: unknown, key: string): boolean {
    return this.arrForce
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
      case 'strict': return !this.filter.keyMatch(key);
      case 'context':
        return !this.arr.some(item => this.hasCell(item, key) && this.filter.treeMatch(key, this.cell(item, key)));
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

  objChildUid(key: string): string { return appendKey(this.uid, key); }
  cellUid(index: number, key: string): string { return appendKey(this.itemUid(index), key); }
  itemUid(index: number): string { return appendKey(this.uid, index); }

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
    this.valueChange.emit(this.switchedByDiscriminator(this.uid, this.value as Record<string, unknown>, key, newValue)
      ?? withEntry(this.value as Record<string, unknown>, key, newValue));
  }

  // Changing the key that tells a schema's variants apart means choosing
  // another variant, so the object gains what that variant requires. The
  // table never removes anything by itself (it has nowhere to ask first):
  // what the new variant does not allow stays, and the schema bar flags it.
  // The form asks before it drops anything.
  private switchedByDiscriminator(uid: string, object: Record<string, unknown>, key: string, newValue: unknown): Record<string, unknown> | undefined {
    if (this.schema.variantsFor(uid)?.property !== key || JSON.stringify(object[key]) === JSON.stringify(newValue)) return undefined;
    return this.schema.switchVariantFor(uid, newValue, false)?.value;
  }

  onEntryDelete(key: string): void {
    this.valueChange.emit(withoutEntry(this.value as Record<string, unknown>, key));
  }

  addEntry(key: string): void {
    const trimmed = key.trim();
    if (!trimmed) return;
    const obj = this.value as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(obj, trimmed)) return;
    // Seeded from the schema when it describes this key or this object is a
    // map with a value schema (e.g. products keyed by slug) — same reasoning
    // as addItem.
    const seeded = this.schema.seedFor(this.uid, trimmed);
    this.valueChange.emit(withEntry(obj, trimmed, seeded !== undefined ? seeded : ''));
    // See addItem's comment: keeps a fully-shown object fully shown.
    this.reveal.revealMore(this.path, 1);
  }

  // --- array mutation (plain items and array-of-objects items alike) ---
  onItemChange(index: number, newValue: unknown): void {
    this.valueChange.emit(withItem(this.arr, index, newValue));
  }

  onItemDelete(index: number): void {
    this.valueChange.emit(withoutItemAt(this.arr, index));
  }

  // Seeded from the array's item schema when there is one; otherwise shaped
  // like the items already there (blankItemLike). Either way appending to
  // an array of records adds a real record, not a bare string with no keys
  // of its own to hold name/price/etc. in.
  addItem(): void {
    const seeded = this.schema.seedItemFor(this.uid);
    const next = withAppended(this.arr, seeded !== undefined ? seeded : blankItemLike(this.arr));
    this.valueChange.emit(next);
    // A short array is normally shown in full (revealedCount === its
    // length); appending an item then leaves it one short, hiding exactly
    // the row just added, with no visible sign anything is missing unless
    // the reveal bar is noticed. Growing the revealed count by one keeps a
    // "fully shown" array fully shown; a genuinely paginated (huge) array
    // is deliberately left as is, so one click never dumps thousands of rows.
    this.reveal.revealMore(this.path, 1);
  }

  // --- array-of-objects cell mutation: edits/deletes one key within one
  // row's object, leaving every other row untouched ---
  onCellChange(index: number, key: string, newValue: unknown): void {
    const item = this.arr[index] as Record<string, unknown>;
    this.onItemChange(index, this.switchedByDiscriminator(this.itemUid(index), item, key, newValue) ?? withEntry(item, key, newValue));
  }

  onCellDelete(index: number, key: string): void {
    const item = this.arr[index] as Record<string, unknown>;
    this.onItemChange(index, withoutEntry(item, key));
  }

  // Fills in a row's missing cell for a shared column. With a schema that
  // knows the key, the starting value comes from it (default, required
  // keys, ...); otherwise it is shaped like whatever another row already
  // has there (same keys/array length, leaves blanked) rather than a bare
  // empty string — so e.g. adding "contact" on a row that lacks it starts
  // you with the same { email, phone } shape other rows use.
  addCellLike(index: number, key: string): void {
    const seeded = this.schema.seedFor(this.itemUid(index), key);
    if (seeded !== undefined) return this.onCellChange(index, key, seeded);
    const source = this.arr.find(item => this.hasCell(item, key));
    const template = source === undefined ? '' : blankLike(this.cell(source, key));
    this.onCellChange(index, key, template);
  }
}
