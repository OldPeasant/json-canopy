import { Component, Input, inject, signal } from '@angular/core';
import { NodeVisibilityService } from '../services/node-visibility.service';

@Component({
  selector: 'app-column-menu',
  standalone: true,
  templateUrl: './column-menu.component.html',
  styleUrl: './column-menu.component.css',
})
export class ColumnMenuComponent {
  @Input({ required: true }) keys: string[] = [];
  @Input({ required: true }) path: string = '';

  private visibility = inject(NodeVisibilityService);

  readonly open = signal(false);

  private colKey(key: string): string {
    return `${this.path}:${key}`;
  }

  isHidden(key: string): boolean {
    return this.visibility.isHidden(this.colKey(key));
  }

  get hiddenCount(): number {
    return this.keys.filter(k => this.isHidden(k)).length;
  }

  toggleOpen(event: Event): void {
    event.stopPropagation();
    this.open.update(v => !v);
  }

  toggleKey(event: Event, key: string): void {
    event.stopPropagation();
    this.visibility.toggle(this.colKey(key));
  }
}
