// Extension -> page and page -> extension message envelope,
// `{"type": ..., "payload": ...}`, carried as a JSON *string* over the
// webview's postMessage channel (the page's bridge speaks strings, see
// HOST_SHIM in webviewHtml.ts). Keep in step with the source of truth,
// src/app/json-explorer/services/host-bridge.service.ts, and its Kotlin
// mirror, intellij-plugin/.../bridge/BridgeMessages.kt.

export interface LoadDocumentPayload {
  fileName: string | null;
  text: string;
  readOnly: boolean;
}

export interface ExternalReloadPayload {
  text: string;
}

export interface SetSchemaPayload {
  status: 'found' | 'needsConsent' | 'none' | 'failed';
  name?: string;
  source?: string;
  text?: string;
  url?: string;
  message?: string;
}

export type OutgoingMessage =
  | { type: 'LOAD_DOCUMENT'; payload: LoadDocumentPayload }
  | { type: 'EXTERNAL_RELOAD'; payload: ExternalReloadPayload }
  | { type: 'SET_SCHEMA'; payload: SetSchemaPayload };

export type IncomingMessage =
  | { type: 'READY'; payload: Record<string, never> }
  | { type: 'DOCUMENT_CHANGED'; payload: { text: string } }
  | { type: 'FETCH_SCHEMA'; payload: { url: string } };

export function encode(message: OutgoingMessage): string {
  return JSON.stringify(message);
}

// Anything that isn't a well-formed message we know is dropped (null): the
// page is our own code, but its input still crosses a process boundary.
export function decode(raw: unknown): IncomingMessage | null {
  if (typeof raw !== 'string') return null;
  let message: { type?: unknown; payload?: unknown };
  try {
    message = JSON.parse(raw);
  } catch {
    return null;
  }
  if (message === null || typeof message !== 'object') return null;
  const payload = (message.payload ?? {}) as Record<string, unknown>;
  switch (message.type) {
    case 'READY':
      return { type: 'READY', payload: {} };
    case 'DOCUMENT_CHANGED':
      return typeof payload.text === 'string' ? { type: 'DOCUMENT_CHANGED', payload: { text: payload.text } } : null;
    case 'FETCH_SCHEMA':
      return typeof payload.url === 'string' ? { type: 'FETCH_SCHEMA', payload: { url: payload.url } } : null;
    default:
      return null;
  }
}
