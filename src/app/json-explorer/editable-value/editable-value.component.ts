import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { JsonType, defaultForType, typeOf } from '../json-edit.util';
import { HighlightComponent } from '../highlight/highlight.component';
import { EditModeService } from '../services/edit-mode.service';
import { SchemaService } from '../services/schema.service';

@Component({
  selector: 'app-editable-value',
  standalone: true,
  imports: [HighlightComponent],
  templateUrl: './editable-value.component.html',
  styleUrl: './editable-value.component.css',
})
export class EditableValueComponent {
  @Input({ required: true }) value: unknown;
  // Instance key of the node this value belongs to; how the schema is asked about it.
  @Input() uid: string = '';
  @Output() valueChange = new EventEmitter<unknown>();

  protected editMode = inject(EditModeService);
  private schema = inject(SchemaService);

  readonly types: JsonType[] = ['string', 'number', 'boolean', 'null', 'object', 'array'];

  // Read-only per the schema: shown as plain text even in edit mode.
  get locked(): boolean {
    return this.editMode.enabled() && this.schema.readOnlyFor(this.uid);
  }

  get type(): JsonType {
    return typeOf(this.value);
  }

  // The values the schema allows here, when it lists them all: shown as a
  // dropdown instead of a free-form input.
  get choices(): readonly (string | number | boolean | null)[] | undefined {
    return this.schema.choicesFor(this.uid);
  }

  // Index of the current value among the choices, or -1 if it isn't one.
  get choiceIndex(): number {
    const now = JSON.stringify(this.value);
    return this.choices?.findIndex(c => JSON.stringify(c) === now) ?? -1;
  }

  choiceLabel(value: unknown): string {
    return value === '' ? '""' : typeof value === 'string' ? value : JSON.stringify(value);
  }

  // What the type dropdown offers: only the types the schema allows, plus
  // the current one so the dropdown can always show what is there now. With
  // a single option there is nothing to choose, so the dropdown is hidden.
  get typeOptions(): JsonType[] {
    const allowed = this.schema.typesFor(this.uid);
    return allowed ? this.types.filter(t => allowed.includes(t) || t === this.type) : this.types;
  }

  onChoice(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const index = Number(select.value);
    const choices = this.choices;
    if (choices && index >= 0 && index !== this.choiceIndex) this.valueChange.emit(choices[index]);
    // A parent may decline the change (a variant switch waiting for
    // confirmation); the dropdown must then show the value that is really
    // there. If the change was applied, the option bindings move it right after.
    setTimeout(() => (select.value = String(this.choiceIndex)));
  }

  onTypeChange(event: Event): void {
    const newType = (event.target as HTMLSelectElement).value as JsonType;
    if (newType === this.type) return;
    this.valueChange.emit(defaultForType(newType));
  }

  commitString(v: string): void {
    if (v === this.value) return;
    this.valueChange.emit(v);
  }

  commitNumber(v: string): void {
    const n = v.trim() === '' ? 0 : Number(v);
    const next = Number.isNaN(n) ? 0 : n;
    if (next === this.value) return;
    this.valueChange.emit(next);
  }

  commitBoolean(checked: boolean): void {
    this.valueChange.emit(checked);
  }
}
