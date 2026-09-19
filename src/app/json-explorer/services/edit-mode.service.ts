import { Injectable, computed, signal } from '@angular/core';

// Global (not per-node) switch between the editor's read/write controls and
// a clean, read-only rendering of the same tree. Defaults to the quiet,
// read-only view — editing is an opt-in a user reaches for deliberately.
@Injectable({ providedIn: 'root' })
export class EditModeService {
  private readonly _enabled = signal(false);
  private readonly _readOnly = signal(false);

  // Effectively OFF whenever the host has marked the current file
  // read-only (see setReadOnly), regardless of the user's own toggle state.
  readonly enabled = computed(() => this._enabled() && !this._readOnly());

  readonly readOnly = this._readOnly.asReadonly();

  toggle(): void {
    if (this._readOnly()) return;
    this._enabled.update(v => !v);
  }

  // Called whenever a new document is loaded, so switching to edit mode for
  // one file doesn't carry over and surprise-edit the next one opened.
  reset(): void {
    this._enabled.set(false);
  }

  // Called by the IntelliJ host bridge when the underlying file isn't
  // writable (e.g. a read-only VFS file) — forces edit mode off and keeps
  // toggle() a no-op until a writable file is loaded. Standalone
  // (non-host) use never calls this, so it stays permanently false there.
  setReadOnly(value: boolean): void {
    this._readOnly.set(value);
    if (value) this._enabled.set(false);
  }
}
