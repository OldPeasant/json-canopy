import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { JsonType, defaultForType, typeOf } from '../json-edit.util';
import { EditModeService } from '../services/edit-mode.service';

@Component({
  selector: 'app-editable-value',
  standalone: true,
  templateUrl: './editable-value.component.html',
  styleUrl: './editable-value.component.css',
})
export class EditableValueComponent {
  @Input({ required: true }) value: unknown;
  @Output() valueChange = new EventEmitter<unknown>();

  protected editMode = inject(EditModeService);

  readonly types: JsonType[] = ['string', 'number', 'boolean', 'null', 'object', 'array'];

  get type(): JsonType {
    return typeOf(this.value);
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
