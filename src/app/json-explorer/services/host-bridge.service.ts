import { Injectable, signal } from '@angular/core';

// Kotlin -> JS and JS -> Kotlin message envelope, `{"type": ..., "payload": ...}`.
// Keep this file as the single source of truth for the wire contract on the
// Angular side — the Kotlin counterpart is
// intellij-plugin/src/main/kotlin/ch/sonensei/canopy/bridge/BridgeMessages.kt.
//
// READY/LOAD_DOCUMENT (open) and DOCUMENT_CHANGED/EXTERNAL_RELOAD
// (write-back) are wired end-to-end (plan steps 3-4). SET_THEME/
// SET_EDIT_MODE/CLIPBOARD_WRITE are separate, later milestones.

export interface LoadDocumentPayload {
  fileName: string | null;
  text: string;
  readOnly: boolean;
}

// Kotlin -> JS, sent after LOAD_DOCUMENT and whenever the file changes
// outside this editor: what the IDE found out about the document's schema.
//   found        `text` is the schema; `name` and `source` say which and why
//   needsConsent the file's $schema is a remote URL the IDE does not have;
//                the page asks the user and answers with fetchSchema(url)
//   none         no schema applies
//   failed       a schema applies but could not be read; `message` says why
export interface SetSchemaPayload {
  status: 'found' | 'needsConsent' | 'none' | 'failed';
  name?: string;
  source?: string;
  text?: string;
  url?: string;
  message?: string;
}

declare global {
  interface Window {
    __JSON_CANOPY_HOST__?: boolean;
    // Registered here, in HostBridgeService's constructor. Called by
    // Kotlin (CanopyBridge.sendLoadDocument, etc.) via executeJavaScript.
    __canopyHost?: { dispatch: (json: string) => void };
    // Defined by Kotlin's per-editor injection script (CanopyBridge
    // .injectionScript()), embedded into <head> before this app boots.
    __canopySendToHost?: (json: string) => void;
  }
}

@Injectable({ providedIn: 'root' })
export class HostBridgeService {
  readonly isHostMode = signal(typeof window !== 'undefined' && window.__JSON_CANOPY_HOST__ === true);

  private loadDocumentHandler: ((payload: LoadDocumentPayload) => void) | null = null;
  private externalReloadHandler: ((text: string) => void) | null = null;
  private setSchemaHandler: ((payload: SetSchemaPayload) => void) | null = null;

  constructor() {
    if (!this.isHostMode()) return;
    window.__canopyHost = { dispatch: (json: string) => this.handleIncoming(json) };
  }

  onLoadDocument(handler: (payload: LoadDocumentPayload) => void): void {
    this.loadDocumentHandler = handler;
  }

  onExternalReload(handler: (text: string) => void): void {
    this.externalReloadHandler = handler;
  }

  onSetSchema(handler: (payload: SetSchemaPayload) => void): void {
    this.setSchemaHandler = handler;
  }

  // The user agreed to download a remote schema; the host fetches it (with
  // the IDE's proxy settings) and answers with SET_SCHEMA.
  fetchSchema(url: string): void {
    this.send('FETCH_SCHEMA', { url });
  }

  // Tells the host we're ready to receive LOAD_DOCUMENT — sent only after
  // `window.__canopyHost.dispatch` above is registered, so there's no
  // race where Kotlin's reply arrives before anything is listening.
  ready(): void {
    this.send('READY', {});
  }

  // A user edit (table UI or Raw JSON apply) — write it back into the real
  // file. Callers are expected to debounce this themselves; the bridge just
  // forwards whatever it's given.
  documentChanged(text: string): void {
    this.send('DOCUMENT_CHANGED', { text });
  }

  private send(type: string, payload: unknown): void {
    if (typeof window.__canopySendToHost !== 'function') return;
    window.__canopySendToHost(JSON.stringify({ type, payload }));
  }

  private handleIncoming(json: string): void {
    let message: { type: string; payload: unknown };
    try {
      message = JSON.parse(json);
    } catch {
      return;
    }
    switch (message.type) {
      case 'LOAD_DOCUMENT':
        this.loadDocumentHandler?.(message.payload as LoadDocumentPayload);
        break;
      case 'EXTERNAL_RELOAD':
        this.externalReloadHandler?.((message.payload as { text: string }).text);
        break;
      case 'SET_SCHEMA':
        this.setSchemaHandler?.(message.payload as SetSchemaPayload);
        break;
    }
  }
}
