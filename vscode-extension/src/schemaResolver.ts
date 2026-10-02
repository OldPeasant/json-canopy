import { SetSchemaPayload } from './bridge';

// Works out which schema applies to a document — the counterpart of the
// IntelliJ plugin's SchemaResolver.kt, in the same order:
//
//  1. a local `$schema` in the file (relative to the file, an absolute path
//     or a `file:` URI): explicit, cheap and deterministic;
//  2. the user's `json.schemas` setting — the closest thing VS Code has to
//     the IDE mappings IntelliJ's JSON plugin offers, since VS Code's JSON
//     language service doesn't tell other extensions which schema it uses;
//  3. a remote `$schema` (or remote `json.schemas` url): `needsConsent`,
//     nothing is downloaded before the user agrees;
//  4. otherwise `none`; a local reference that can't be read is `failed`.
//
// Locations are URI strings, so this file needs no `vscode` import and is
// unit-tested directly; the editor supplies the I/O.

/** One entry of the `json.schemas` setting. */
export interface SchemaAssociation {
  fileMatch?: string[];
  url?: string;
  schema?: unknown;
}

export interface ResolveInput {
  documentText: string;
  /** e.g. `file:///home/me/project/a.json` */
  documentUri: string;
  /** The workspace folder holding the document, or null. Base for fileMatch and relative urls. */
  folderUri: string | null;
  /** All `json.schemas` entries, most specific scope first (folder, workspace, user). */
  associations: SchemaAssociation[];
}

export interface ResolverIo {
  /** The text at a URI (an open editor's unsaved text if there is one), or null if it can't be read. */
  readText(uri: string): Promise<string | null>;
}

export async function resolveSchema(input: ResolveInput, io: ResolverIo): Promise<SetSchemaPayload> {
  const ref = documentSchemaRef(input.documentText);
  let localProblem: string | null = null;

  if (ref !== null && !isRemote(ref)) {
    const target = resolveReference(ref, input.documentUri);
    const text = target === null ? null : await io.readText(target);
    if (target !== null && text !== null) return found(text, baseName(target), '$schema in the file');
    localProblem = `Cannot find the schema file '${ref}' referenced by $schema.`;
  }

  const association = findAssociation(input);
  if (association) {
    if (association.schema !== undefined && association.schema !== null) {
      return found(JSON.stringify(association.schema), 'inline schema', 'json.schemas setting');
    }
    const url = association.url?.trim();
    if (url) {
      if (isRemote(url)) return { status: 'needsConsent', url };
      const target = input.folderUri === null && isRelative(url) ? null : resolveReference(url, folderBase(input));
      const text = target === null ? null : await io.readText(target);
      if (target !== null && text !== null) return found(text, baseName(target), 'json.schemas setting');
      return { status: 'failed', message: `Cannot read the schema '${url}' from the json.schemas setting.` };
    }
  }

  if (ref !== null && isRemote(ref)) return { status: 'needsConsent', url: ref };
  return localProblem !== null ? { status: 'failed', message: localProblem } : { status: 'none' };
}

/** Downloads a schema the user agreed to fetch. */
export async function downloadSchema(url: string, fetchImpl: typeof fetch = fetch): Promise<SetSchemaPayload> {
  if (!isRemote(url)) return { status: 'failed', message: `Only http and https schemas can be downloaded: ${url}` };
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/schema+json, application/json, */*' },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) return { status: 'failed', message: `Could not download ${url}: HTTP ${response.status}` };
    return found(await response.text(), baseName(url) || url, `downloaded from ${url}`);
  } catch (e) {
    return { status: 'failed', message: `Could not download ${url}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

const DOWNLOAD_TIMEOUT_MS = 20_000;

/**
 * The schema state of one open editor: resolves on demand, and remembers
 * the remote URL it last offered and the one schema the user agreed to
 * download — the same rules as the IntelliJ CanopyFileEditor: the page may
 * only make us fetch the URL we offered, and a downloaded schema is reused
 * for the editor's lifetime so an edit doesn't ask the same question again.
 */
export class SchemaSession {
  private offeredUrl: string | null = null;
  private downloaded: { url: string; payload: SetSchemaPayload } | null = null;

  constructor(
    private readonly io: ResolverIo,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async resolve(input: ResolveInput): Promise<SetSchemaPayload> {
    let result: SetSchemaPayload;
    try {
      result = await resolveSchema(input, this.io);
    } catch (e) {
      result = { status: 'failed', message: `Could not look up the schema: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (result.status === 'needsConsent') {
      const downloaded = this.downloaded;
      if (downloaded !== null && downloaded.url === result.url) return downloaded.payload;
      this.offeredUrl = result.url ?? null;
    }
    return result;
  }

  /** The page's FETCH_SCHEMA: null when the URL was not the one offered. */
  async fetchOffered(url: string): Promise<SetSchemaPayload | null> {
    if (url !== this.offeredUrl) return null;
    const result = await downloadSchema(url, this.fetchImpl);
    if (result.status === 'found') this.downloaded = { url, payload: result };
    return result;
  }
}

// --- `$schema` and references ---------------------------------------------

/** The top-level `$schema` string of a JSON document, or null. */
export function documentSchemaRef(text: string): string | null {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return null;
  }
  if (root === null || typeof root !== 'object' || Array.isArray(root)) return null;
  const ref = (root as Record<string, unknown>)['$schema'];
  return typeof ref === 'string' && ref.trim() !== '' ? ref.trim() : null;
}

export function isRemote(ref: string): boolean {
  return /^https?:\/\//i.test(ref.trim());
}

const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;

function isRelative(ref: string): boolean {
  return !/^[A-Za-z][A-Za-z0-9+.-]+:/.test(ref) && !ref.startsWith('/') && !WINDOWS_DRIVE.test(ref);
}

/**
 * A reference (relative path, absolute path, Windows drive path or URI) as a
 * URI string, resolved against `base` (a document or folder URI). Null when
 * it can't be (e.g. a relative path next to an untitled document).
 */
export function resolveReference(ref: string, base: string): string | null {
  const trimmed = ref.trim();
  try {
    if (WINDOWS_DRIVE.test(trimmed)) return new URL('file:///' + trimmed.replace(/\\/g, '/')).href;
    if (/^file:/i.test(trimmed)) return new URL(trimmed).href;
    if (!isRelative(trimmed) && !trimmed.startsWith('/')) return null;
    const resolved = new URL(trimmed.replace(/\\/g, '/'), base);
    // An opaque base (untitled:Untitled-1) "resolves" to nonsense or throws.
    return resolved.protocol === new URL(base).protocol && resolved.pathname.startsWith('/') ? resolved.href : null;
  } catch {
    return null;
  }
}

function folderBase(input: ResolveInput): string {
  return input.folderUri === null ? input.documentUri : input.folderUri.replace(/\/?$/, '/');
}

function baseName(uri: string): string {
  const path = uri.replace(/[?#].*$/, '').replace(/\/+$/, '');
  try {
    return decodeURIComponent(path.substring(path.lastIndexOf('/') + 1));
  } catch {
    return path.substring(path.lastIndexOf('/') + 1);
  }
}

function found(text: string, name: string, source: string): SetSchemaPayload {
  return { status: 'found', name, source, text };
}

// --- json.schemas fileMatch -------------------------------------------------

/**
 * The first `json.schemas` entry whose fileMatch applies to the document,
 * matched like VS Code's JSON support does: against the path within the
 * workspace folder; a pattern starting with "/" is anchored at the folder,
 * any other matches at any depth; "!pattern" excludes. (VS Code combines
 * several matching entries; we take the most specific one.)
 */
export function findAssociation(input: ResolveInput): SchemaAssociation | null {
  const path = documentPath(input);
  if (path === null) return null;
  for (const association of input.associations) {
    const patterns = (association.fileMatch ?? []).filter((p) => typeof p === 'string' && p.trim() !== '');
    const include = patterns.filter((p) => !p.startsWith('!'));
    const exclude = patterns.filter((p) => p.startsWith('!')).map((p) => p.substring(1));
    if (include.some((p) => globMatches(p, path)) && !exclude.some((p) => globMatches(p, path))) return association;
  }
  return null;
}

// The document's path inside its folder ("sub/a.json"), or its full path
// ("home/me/a.json") outside any folder.
function documentPath(input: ResolveInput): string | null {
  let doc: URL;
  try {
    doc = new URL(input.documentUri);
  } catch {
    return null;
  }
  const docPath = decodeURIComponent(doc.pathname);
  if (input.folderUri !== null) {
    const folderPath = decodeURIComponent(new URL(input.folderUri).pathname).replace(/\/?$/, '/');
    if (docPath.startsWith(folderPath)) return docPath.substring(folderPath.length);
  }
  return docPath.replace(/^\/+/, '');
}

export function globMatches(pattern: string, path: string): boolean {
  const trimmed = pattern.trim();
  const anchored = trimmed.startsWith('/');
  const body = globToRegex(anchored ? trimmed.substring(1) : trimmed);
  return new RegExp(`^${anchored ? '' : '(?:.*/)?'}${body}$`).test(path);
}

function globToRegex(glob: string): string {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') {
        i++;
        out += '(?:.*/)?';
      } else {
        out += '.*';
      }
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else if (c === '{') {
      const close = glob.indexOf('}', i);
      if (close < 0) out += '\\{';
      else {
        out += '(?:' + glob.substring(i + 1, close).split(',').map(globToRegex).join('|') + ')';
        i = close;
      }
    } else out += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return out;
}

// --- Keeping the page informed ---------------------------------------------

/**
 * Feeds one page its SET_SCHEMA messages. Refreshes are debounced (typing
 * in the text tab re-resolves at most every [delayMs]), only the newest
 * lookup may answer (a slow one that finishes late is dropped), and a
 * result equal to the last one sent is not sent again — the page reloads
 * the schema on every SET_SCHEMA, which would be wasted work on each edit.
 */
export class SchemaUpdates {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private lastSent: string | null = null;

  constructor(
    private readonly session: SchemaSession,
    private readonly currentInput: () => ResolveInput,
    private readonly send: (payload: SetSchemaPayload) => void,
    private readonly delayMs = 250,
  ) {}

  /** The page (re)loaded: it knows nothing, so the next result is always sent. */
  async pageReady(): Promise<void> {
    this.lastSent = null;
    await this.refreshNow();
  }

  /** The document or the settings changed. */
  refreshSoon(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refreshNow();
    }, this.delayMs);
  }

  /** The page's FETCH_SCHEMA. False when the URL was not offered. */
  async fetch(url: string): Promise<boolean> {
    const generation = ++this.generation;
    const result = await this.session.fetchOffered(url);
    if (result === null) return false;
    this.deliver(generation, result);
    return true;
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.generation++;
  }

  private async refreshNow(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const generation = ++this.generation;
    this.deliver(generation, await this.session.resolve(this.currentInput()));
  }

  private deliver(generation: number, payload: SetSchemaPayload): void {
    if (generation !== this.generation) return;
    const key = JSON.stringify(payload);
    if (key === this.lastSent) return;
    this.lastSent = key;
    this.send(payload);
  }
}
