import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { appendKey, type GhostKey, type Problem, type VariantInfo, type VariantSwitch } from '../../schema';
import { EditableValueComponent } from '../editable-value/editable-value.component';
import { FormField, formFields } from '../form-fields.util';
import { estimateAvgItemBytes, formRevealKey, initialFormRevealCount } from '../reveal.util';
import { JsonType, typeOf, withEntry, withoutEntry } from '../json-edit.util';
import { HighlightComponent } from '../highlight/highlight.component';
import { JsonTableComponent } from '../json-table/json-table.component';
import { SchemaInfoComponent } from '../schema-info/schema-info.component';
import { CollapseService } from '../services/collapse.service';
import { EditModeService } from '../services/edit-mode.service';
import { FilterService } from '../services/filter.service';
import { FocusService } from '../services/focus.service';
import { RevealService } from '../services/reveal.service';
import { SchemaService } from '../services/schema.service';

type Kind = 'object' | 'array' | 'scalar';

const NO_GHOSTS: readonly GhostKey[] = [];

// The form rendering of a document: an object is a list of labelled fields
// in schema order, a nested object is a collapsible group, and an array
// hands over to the table (a list of records is best read as a table, even
// inside a form). Uses the same instance keys (`uid`) and structural paths
// as the table, so problems, collapse state and jump-to-problem work alike.
@Component({
  selector: 'app-json-form',
  standalone: true,
  imports: [JsonFormComponent, JsonTableComponent, EditableValueComponent, SchemaInfoComponent, HighlightComponent],
  templateUrl: './json-form.component.html',
  styleUrl: './json-form.component.css',
})
export class JsonFormComponent {
  @Input({ required: true }) value!: unknown;
  @Input() path: string = '';
  @Input() uid: string = '';
  // How many groups deep this object sits. The label column shrinks by the
  // indentation each level adds, so the value column stays where it is.
  @Input() depth: number = 0;
  // Set by a parent whose own key directly matched the search (or was itself
  // forced): everything below stays visible, whatever it contains.
  @Input() forceVisible: boolean = false;
  // The search's default for this group: its name shown, its content behind a click.
  @Input() filterCollapsed: boolean = false;

  // The new value for THIS node, rebuilt one level at a time like the table's.
  @Output() valueChange = new EventEmitter<unknown>();

  protected editMode = inject(EditModeService);
  protected filter = inject(FilterService);
  protected reveal = inject(RevealService);
  private focus = inject(FocusService);
  private schema = inject(SchemaService);
  private collapse = inject(CollapseService);

  // A variant switch that would lose data, waiting for the user to confirm.
  protected pending?: { label: string; to: unknown; sw: VariantSwitch };

  private fieldMemo?: { value: unknown; ghosts: readonly GhostKey[]; declared: readonly string[]; required: ReadonlySet<string>; fields: FormField[]; avgBytes: number };

  get type(): JsonType { return typeOf(this.value); }

  // Edit controls at this object: on in edit mode, unless the schema makes it read-only.
  get canEdit(): boolean {
    return this.editMode.enabled() && !this.schema.readOnlyFor(this.uid);
  }

  // Problems about the whole document; every other node shows its own on its label.
  get rootProblems(): readonly Problem[] {
    return this.uid === '' ? this.schema.index().at('') : [];
  }

  // The variants this object can be, when a discriminator tells them apart.
  get variants(): VariantInfo | undefined {
    return this.type === 'object' ? this.schema.variantsFor(this.uid) : undefined;
  }

  get activeVariant(): number | undefined {
    return this.variants ? this.schema.variantIndexFor(this.uid) : undefined;
  }

  get fields(): FormField[] {
    const value = this.value as Record<string, unknown>;
    const ghosts = this.schema.ghostsFor(this.uid);
    const declared = this.schema.declaredKeys(this.uid);
    const required = this.schema.requiredFor(this.uid);
    const memo = this.fieldMemo;
    if (memo && memo.value === value && memo.ghosts === ghosts && memo.declared === declared && memo.required === required) return memo.fields;
    const fields = formFields(value, declared, ghosts.length ? ghosts : NO_GHOSTS, required);
    this.fieldMemo = { value, ghosts, declared, required, fields, avgBytes: estimateAvgItemBytes(value, Object.values(value)) };
    return fields;
  }

  // Expanding a group by hand shows everything below it, whatever the search
  // would otherwise hide there.
  private get effectiveForce(): boolean {
    return this.forceVisible || this.collapse.get(this.uid, this.path) === false;
  }

  private get entries(): Array<[string, unknown]> {
    return Object.entries(this.value as Record<string, unknown>);
  }

  // The fields the search leaves: those whose name or content matches, all of
  // them when something above matched, or (Context mode) when any of them
  // leads to a match.
  // An absent field is only worth showing if its name is what was searched for.
  get visibleFields(): FormField[] {
    const fields = this.fields;
    if (!this.filter.active) return fields;
    const value = this.value as Record<string, unknown>;
    const widened = this.filter.widens(this.entries);
    return fields.filter(f => f.ghost
      ? this.filter.keyMatch(f.key)
      : this.effectiveForce || widened || this.filter.treeMatch(f.key, value[f.key]));
  }

  // --- pagination: a very large object shows a first page, like a table ---
  get revealedCount(): number {
    const length = this.visibleFields.length;
    return this.reveal.count(formRevealKey(this.path), length, initialFormRevealCount(length, this.fieldMemo?.avgBytes ?? 0));
  }

  get pagedFields(): FormField[] {
    return this.visibleFields.slice(0, this.revealedCount);
  }

  get hasMore(): boolean { return this.revealedCount < this.visibleFields.length; }

  revealMore(by: number): void { this.reveal.revealMore(formRevealKey(this.path), by); }

  revealAll(): void { this.reveal.revealAll(formRevealKey(this.path)); }

  childForce(key: string): boolean {
    return this.effectiveForce || this.filter.forces(key, this.childOf(key)) || this.filter.groupMatch(this.entries);
  }

  childFilterCollapsed(key: string): boolean {
    return !this.childForce(key) && this.filter.collapsedByFilter(key, this.childOf(key));
  }

  keyDim(key: string): boolean {
    return this.filter.keyDim(key, this.childOf(key));
  }

  childOf(key: string): unknown { return (this.value as Record<string, unknown>)[key]; }

  kindOf(value: unknown): Kind {
    const type = typeOf(value);
    return type === 'object' ? 'object' : type === 'array' ? 'array' : 'scalar';
  }

  objectSize(value: unknown): number { return Object.keys(value as object).length; }

  childUid(key: string): string { return appendKey(this.uid, key); }
  childPath(key: string): string { return this.path ? `${this.path}.${key}` : key; }

  // --- what the schema and validation say about a field ---
  problemsAt(key: string): readonly Problem[] { return this.schema.index().at(this.childUid(key)); }

  problemTitle(key: string): string { return this.problemsAt(key).map(p => p.message).join('\n'); }

  // Everything wrong at or below a field — what a collapsed group is hiding.
  problemCount(key: string): number {
    const index = this.schema.index();
    const uid = this.childUid(key);
    return index.at(uid).length + index.countBelow(uid);
  }

  isDeprecated(key: string): boolean { return this.schema.metaFor(this.childUid(key))?.deprecated === true; }

  ghostHint(g: GhostKey): string {
    return g.hasDefault ? `default ${JSON.stringify(g.default)}` : 'not set';
  }

  ghostTitle(g: GhostKey): string {
    return g.schema.description ?? (g.required ? 'Required by the schema' : 'Optional key from the schema');
  }

  // A field is in focus when it gains focus or is clicked. Events bubble
  // through the enclosing fields too, and the innermost one must win.
  onFocus(key: string, event: Event): void {
    const seen = event as Event & { canopyFocusHandled?: boolean };
    if (seen.canopyFocusHandled) return;
    seen.canopyFocusHandled = true;
    this.focus.set(this.childUid(key));
  }

  // --- groups ---
  isCollapsed(key: string): boolean {
    return this.collapse.get(this.childUid(key), this.childPath(key)) ?? this.childFilterCollapsed(key);
  }

  // Shift-click applies to every related node (same structural path).
  toggle(key: string, event: MouseEvent): void {
    this.collapse.set(this.childUid(key), this.childPath(key), !this.isCollapsed(key), event.shiftKey);
  }

  // --- edits ---
  onFieldChange(key: string, newValue: unknown): void {
    // Changing the discriminator is choosing a variant, whichever control did it.
    if (this.variants?.property === key && JSON.stringify(newValue) !== JSON.stringify(this.childOf(key))) {
      this.requestSwitch(newValue);
      return;
    }
    this.valueChange.emit(withEntry(this.value as Record<string, unknown>, key, newValue));
  }

  // --- variants ---
  // Switches straight away when nothing would be lost; otherwise asks first,
  // saying exactly what would go.
  requestSwitch(to: unknown): void {
    const sw = this.schema.switchVariantFor(this.uid, to);
    if (!sw) return;
    if (!sw.dropped.length && !sw.reset.length) {
      this.pending = undefined;
      this.valueChange.emit(sw.value);
      return;
    }
    const label = this.variants?.variants.find(v => v.values.some(x => JSON.stringify(x) === JSON.stringify(to)))?.label ?? String(to);
    this.pending = { label, to, sw };
  }

  confirmSwitch(): void {
    if (!this.pending) return;
    // Recomputed: the data may have changed while the question was open.
    const sw = this.schema.switchVariantFor(this.uid, this.pending.to);
    this.pending = undefined;
    if (sw) this.valueChange.emit(sw.value);
  }

  cancelSwitch(): void {
    this.pending = undefined;
  }

  onFieldDelete(key: string): void {
    this.valueChange.emit(withoutEntry(this.value as Record<string, unknown>, key));
  }

  addGhost(g: GhostKey): void {
    this.onFieldChange(g.key, this.schema.seed(g.schema));
  }

  addEntry(key: string): void {
    const trimmed = key.trim();
    if (!trimmed || Object.prototype.hasOwnProperty.call(this.value, trimmed)) return;
    this.onFieldChange(trimmed, this.schema.seedFor(this.uid, trimmed) ?? '');
    // See JsonTableComponent.addItem's comment: keeps a fully-shown object
    // fully shown. Ghost keys (declared but absent) don't need this — they
    // are already counted in `fields`/`visibleFields` before being added.
    this.reveal.revealMore(formRevealKey(this.path), 1);
  }
}
