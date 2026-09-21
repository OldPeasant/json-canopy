import type { Layout } from './layout.util';

/** The part of `Storage` this needs; a Map-backed fake works in tests. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const PREFIX = 'canopy.layout.';

/**
 * Remembers which layout the user chose for a schema. Best-effort: browser
 * storage can be missing, blocked or full (a webview may clear it), and a
 * remembered layout is a convenience, so nothing here ever throws.
 */
export class LayoutMemory {
  constructor(private readonly store: () => KeyValueStore | undefined) {}

  get(schemaKey: string): Layout | undefined {
    try {
      const value = this.store()?.getItem(PREFIX + schemaKey);
      return value === 'tables' || value === 'form' ? value : undefined;
    } catch {
      return undefined;
    }
  }

  set(schemaKey: string, layout: Layout): void {
    try {
      this.store()?.setItem(PREFIX + schemaKey, layout);
    } catch {
      // Not remembered; the choice still applies to this document.
    }
  }
}
