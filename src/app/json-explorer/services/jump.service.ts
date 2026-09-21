import { Injectable, inject } from '@angular/core';
import { pathKey, type Problem } from '../../schema';
import { estimateAvgItemBytes, initialRevealCount } from '../reveal.util';
import { revealSteps, type RevealStep } from '../jump-steps.util';
import { CollapseService } from './collapse.service';
import { FilterService } from './filter.service';
import { NodeVisibilityService } from './node-visibility.service';
import { RevealService } from './reveal.service';
import { SchemaService } from './schema.service';

// Takes the user to the node a schema problem is shown on: undoes whatever
// hides it — an active search, a collapsed ancestor, a hidden column, rows
// beyond the revealed page — then scrolls to it and flashes it.
@Injectable({ providedIn: 'root' })
export class JumpService {
  private collapse = inject(CollapseService);
  private reveal = inject(RevealService);
  private visibility = inject(NodeVisibilityService);
  private filter = inject(FilterService);
  private schema = inject(SchemaService);

  to(problem: Problem, data: unknown): void {
    // A search would keep hiding the node. Clearing it also drops every
    // collapse choice, so it has to come before the ancestors are expanded.
    if (this.filter.active) this.filter.clear();
    const anchor = this.schema.index().anchorOf(problem);
    for (const step of revealSteps(data, anchor)) {
      if (this.collapse.get(step.uid, step.path) === true) this.collapse.set(step.uid, step.path, false, false);
      if (step.colKey && this.visibility.isHidden(step.colKey)) this.visibility.toggle(step.colKey);
      const { length, initial } = this.sizeOf(step);
      this.reveal.ensure(step.path, step.position, length, initial);
    }
    this.focusWhenRendered(pathKey(anchor));
  }

  // The same numbers the table itself uses to decide its first page.
  private sizeOf(step: RevealStep): { length: number; initial: number } {
    const items = step.kind === 'object' ? Object.values(step.container as object) : (step.container as unknown[]);
    return { length: items.length, initial: initialRevealCount(items.length, estimateAvgItemBytes(step.container as object, items)) };
  }

  // The node renders after the state changes above, so look for its marker
  // for a moment rather than once.
  private focusWhenRendered(key: string, attempt = 0): void {
    const marker = document.querySelector(`[data-problem-key="${CSS.escape(key)}"]`);
    if (marker) {
      const target = marker.closest('td, th, .field') ?? marker;
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      target.classList.remove('jump-flash');
      void (target as HTMLElement).offsetWidth; // restart the animation if it is already running
      target.classList.add('jump-flash');
      setTimeout(() => target.classList.remove('jump-flash'), 1600);
    } else if (attempt < 20) {
      setTimeout(() => this.focusWhenRendered(key, attempt + 1), 50);
    }
  }
}
