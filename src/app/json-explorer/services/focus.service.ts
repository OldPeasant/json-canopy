import { Injectable, signal } from '@angular/core';

// The node the user is working on, by instance key (`uid`): set when a form
// field gains focus or is clicked, and by a jump from the problem list. The
// docs panel follows it.
@Injectable({ providedIn: 'root' })
export class FocusService {
  private readonly _key = signal<string | undefined>(undefined);

  readonly key = this._key.asReadonly();

  set(key: string | undefined): void {
    this._key.set(key);
  }
}
