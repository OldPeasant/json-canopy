import { describe, expect, it } from 'vitest';
import {
  documentSchemaRef,
  downloadSchema,
  findAssociation,
  globMatches,
  ResolveInput,
  resolveReference,
  resolveSchema,
  SchemaSession,
  SchemaUpdates,
} from './schemaResolver';

const FOLDER = 'file:///work/proj';
const DOC = 'file:///work/proj/config/app.json';

function files(map: Record<string, string>) {
  const reads: string[] = [];
  return {
    reads,
    io: {
      readText: async (uri: string) => {
        reads.push(uri);
        return map[uri] ?? null;
      },
    },
  };
}

function input(over: Partial<ResolveInput> = {}): ResolveInput {
  return { documentText: '{}', documentUri: DOC, folderUri: FOLDER, associations: [], ...over };
}

const doc = (schema: string) => JSON.stringify({ $schema: schema, a: 1 });

describe('resolveSchema', () => {
  it('uses a local $schema relative to the file', async () => {
    const { io } = files({ 'file:///work/proj/schemas/app.schema.json': '{"type":"object"}' });
    expect(await resolveSchema(input({ documentText: doc('../schemas/app.schema.json') }), io)).toEqual({
      status: 'found',
      name: 'app.schema.json',
      source: '$schema in the file',
      text: '{"type":"object"}',
    });
  });

  it('prefers a local $schema over a json.schemas mapping', async () => {
    const { io } = files({ 'file:///work/proj/config/local.json': 'L', 'file:///work/proj/mapped.json': 'M' });
    const result = await resolveSchema(
      input({ documentText: doc('./local.json'), associations: [{ fileMatch: ['app.json'], url: './mapped.json' }] }),
      io,
    );
    expect(result.text).toBe('L');
  });

  it('falls back to json.schemas when the local $schema is missing', async () => {
    const { io } = files({ 'file:///work/proj/mapped.json': 'M' });
    const result = await resolveSchema(
      input({ documentText: doc('./gone.json'), associations: [{ fileMatch: ['app.json'], url: './mapped.json' }] }),
      io,
    );
    expect(result).toMatchObject({ status: 'found', text: 'M', source: 'json.schemas setting' });
  });

  it('fails when a local $schema is missing and nothing else applies', async () => {
    const result = await resolveSchema(input({ documentText: doc('./gone.json') }), files({}).io);
    expect(result).toEqual({ status: 'failed', message: "Cannot find the schema file './gone.json' referenced by $schema." });
  });

  it('resolves json.schemas urls against the workspace folder, not the file', async () => {
    const { io, reads } = files({});
    await resolveSchema(input({ associations: [{ fileMatch: ['*.json'], url: './schemas/x.json' }] }), io);
    expect(reads).toEqual(['file:///work/proj/schemas/x.json']);
  });

  it('uses an inline schema from json.schemas', async () => {
    const result = await resolveSchema(
      input({ associations: [{ fileMatch: ['app.json'], schema: { type: 'object' } }] }),
      files({}).io,
    );
    expect(result).toEqual({ status: 'found', name: 'inline schema', source: 'json.schemas setting', text: '{"type":"object"}' });
  });

  it('asks before using a remote json.schemas url, even over a remote $schema', async () => {
    const result = await resolveSchema(
      input({
        documentText: doc('https://a.example/doc.json'),
        associations: [{ fileMatch: ['app.json'], url: 'https://b.example/mapped.json' }],
      }),
      files({}).io,
    );
    expect(result).toEqual({ status: 'needsConsent', url: 'https://b.example/mapped.json' });
  });

  it('asks before using a remote $schema', async () => {
    const result = await resolveSchema(input({ documentText: doc('https://json.schemastore.org/package') }), files({}).io);
    expect(result).toEqual({ status: 'needsConsent', url: 'https://json.schemastore.org/package' });
  });

  it('reports a json.schemas url it cannot read', async () => {
    const result = await resolveSchema(input({ associations: [{ fileMatch: ['app.json'], url: './nope.json' }] }), files({}).io);
    expect(result.status).toBe('failed');
  });

  it('is none for a document without schema, and for one that is not JSON', async () => {
    expect(await resolveSchema(input(), files({}).io)).toEqual({ status: 'none' });
    expect(await resolveSchema(input({ documentText: '{ broken' }), files({}).io)).toEqual({ status: 'none' });
  });

  it('cannot resolve a relative $schema of an untitled document', async () => {
    const result = await resolveSchema(
      input({ documentUri: 'untitled:Untitled-1', folderUri: null, documentText: doc('./x.json') }),
      files({}).io,
    );
    expect(result.status).toBe('failed');
  });
});

describe('resolveReference', () => {
  it('handles relative, absolute, file: and Windows paths', () => {
    expect(resolveReference('s.json', DOC)).toBe('file:///work/proj/config/s.json');
    expect(resolveReference('../a b.json', DOC)).toBe('file:///work/proj/a%20b.json');
    expect(resolveReference('/etc/s.json', DOC)).toBe('file:///etc/s.json');
    expect(resolveReference('file:///x/s.json', DOC)).toBe('file:///x/s.json');
    expect(resolveReference('C:\\schemas\\s.json', DOC)).toBe('file:///C:/schemas/s.json');
  });

  it('keeps a remote document on its own scheme', () => {
    expect(resolveReference('s.json', 'vscode-remote://ssh-remote+box/home/a.json')).toBe('vscode-remote://ssh-remote+box/home/s.json');
  });

  it('refuses other schemes and opaque bases', () => {
    expect(resolveReference('vscode://schemas/settings', DOC)).toBeNull();
    expect(resolveReference('x.json', 'untitled:Untitled-1')).toBeNull();
  });
});

describe('findAssociation / globMatches', () => {
  it('matches unanchored patterns at any depth, anchored ones at the folder root', () => {
    expect(globMatches('app.json', 'config/app.json')).toBe(true);
    expect(globMatches('*.json', 'config/app.json')).toBe(true);
    expect(globMatches('/app.json', 'config/app.json')).toBe(false);
    expect(globMatches('/config/app.json', 'config/app.json')).toBe(true);
    expect(globMatches('/config/*.json', 'config/sub/app.json')).toBe(false);
    expect(globMatches('/config/**/*.json', 'config/sub/app.json')).toBe(true);
    expect(globMatches('/config/**/*.json', 'config/app.json')).toBe(true);
    expect(globMatches('*.{json,jsonc}', 'a.jsonc')).toBe(true);
    expect(globMatches('a?.json', 'ab.json')).toBe(true);
    expect(globMatches('app.json', 'config/xapp.json')).toBe(false);
    expect(globMatches('app.json', 'appXjson')).toBe(false);
  });

  it('honours exclusions and takes the first (most specific) match', () => {
    const associations = [
      { fileMatch: ['*.json', '!app.json'], url: 'first' },
      { fileMatch: ['config/*.json'], url: 'second' },
      { fileMatch: ['*.json'], url: 'third' },
    ];
    expect(findAssociation(input({ associations }))?.url).toBe('second');
  });

  it('matches against the full path outside a workspace folder', () => {
    expect(findAssociation(input({ folderUri: null, associations: [{ fileMatch: ['/work/**/app.json'] }] }))).not.toBeNull();
  });

  it('ignores entries without fileMatch', () => {
    expect(findAssociation(input({ associations: [{ url: './x.json' }] }))).toBeNull();
  });
});

describe('documentSchemaRef', () => {
  it('reads only a top-level, non-empty string $schema', () => {
    expect(documentSchemaRef('{"$schema":" ./s.json "}')).toBe('./s.json');
    expect(documentSchemaRef('{"$schema":""}')).toBeNull();
    expect(documentSchemaRef('{"$schema":1}')).toBeNull();
    expect(documentSchemaRef('[{"$schema":"x"}]')).toBeNull();
    expect(documentSchemaRef('{"a":{"$schema":"x"}}')).toBeNull();
  });
});

function fakeFetch(responses: Record<string, { status: number; body: string } | Error>) {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(url);
    const r = responses[url];
    if (r === undefined || r instanceof Error) throw r ?? new Error('offline');
    return new Response(r.body, { status: r.status });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

describe('downloadSchema', () => {
  it('reports HTTP errors and network failures as failed', async () => {
    const { impl } = fakeFetch({ 'https://x/404.json': { status: 404, body: '' } });
    expect(await downloadSchema('https://x/404.json', impl)).toEqual({ status: 'failed', message: 'Could not download https://x/404.json: HTTP 404' });
    expect((await downloadSchema('https://x/down.json', impl)).message).toContain('offline');
  });

  it('refuses anything but http(s)', async () => {
    expect((await downloadSchema('file:///etc/passwd')).status).toBe('failed');
  });
});

describe('SchemaSession', () => {
  const remote = input({ documentText: doc('https://x/s.json') });

  it('fetches only the URL it offered', async () => {
    const { impl, calls } = fakeFetch({ 'https://x/s.json': { status: 200, body: '{}' }, 'https://evil/s.json': { status: 200, body: '{}' } });
    const session = new SchemaSession(files({}).io, impl);
    expect(await session.fetchOffered('https://x/s.json')).toBeNull();
    await session.resolve(remote);
    expect(await session.fetchOffered('https://evil/s.json')).toBeNull();
    expect(await session.fetchOffered('https://x/s.json')).toMatchObject({ status: 'found', name: 's.json', source: 'downloaded from https://x/s.json' });
    expect(calls).toEqual(['https://x/s.json']);
  });

  it('reuses a downloaded schema instead of asking again', async () => {
    const { impl, calls } = fakeFetch({ 'https://x/s.json': { status: 200, body: '{"title":"S"}' } });
    const session = new SchemaSession(files({}).io, impl);
    await session.resolve(remote);
    await session.fetchOffered('https://x/s.json');
    expect(await session.resolve(remote)).toMatchObject({ status: 'found', text: '{"title":"S"}' });
    expect(calls.length).toBe(1);
  });

  it('asks again for a different URL', async () => {
    const { impl } = fakeFetch({ 'https://x/s.json': { status: 200, body: '{}' } });
    const session = new SchemaSession(files({}).io, impl);
    await session.resolve(remote);
    await session.fetchOffered('https://x/s.json');
    expect(await session.resolve(input({ documentText: doc('https://x/other.json') }))).toEqual({ status: 'needsConsent', url: 'https://x/other.json' });
  });

  it('turns an unexpected error into failed', async () => {
    const session = new SchemaSession({ readText: () => Promise.reject(new Error('boom')) });
    expect(await session.resolve(input({ documentText: doc('./s.json') }))).toEqual({ status: 'failed', message: 'Could not look up the schema: boom' });
  });
});

describe('SchemaUpdates', () => {
  function setUpUpdates(io = files({ 'file:///work/proj/config/s.json': '{}' }).io) {
    const sent: unknown[] = [];
    let current = input({ documentText: doc('./s.json') });
    const updates = new SchemaUpdates(new SchemaSession(io), () => current, (p) => sent.push(p), 10);
    return { sent, updates, setText: (text: string) => (current = input({ documentText: text })) };
  }
  const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('sends on page ready, and again on every page reload', async () => {
    const { sent, updates } = setUpUpdates();
    await updates.pageReady();
    await updates.pageReady();
    expect(sent.length).toBe(2);
  });

  it('does not repeat an unchanged result', async () => {
    const { sent, updates, setText } = setUpUpdates();
    await updates.pageReady();
    setText(JSON.stringify({ $schema: './s.json', other: 2 }));
    updates.refreshSoon();
    await tick(30);
    expect(sent.length).toBe(1);
    setText('{}');
    updates.refreshSoon();
    await tick(30);
    expect(sent).toEqual([expect.objectContaining({ status: 'found' }), { status: 'none' }]);
  });

  it('debounces bursts of changes', async () => {
    let lookups = 0;
    const { updates, setText } = setUpUpdates({ readText: async () => (lookups++, '{}') });
    for (let i = 0; i < 5; i++) {
      setText(doc(`./s${i}.json`));
      updates.refreshSoon();
    }
    await tick(30);
    expect(lookups).toBe(1);
  });

  it('drops a slow lookup that a newer one overtook', async () => {
    let release: (v: string) => void = () => {};
    const io = {
      readText: (uri: string) => (uri.endsWith('slow.json') ? new Promise<string>((r) => (release = r)) : Promise.resolve('FAST')),
    };
    const { sent, updates, setText } = setUpUpdates(io);
    setText(doc('./slow.json'));
    const slow = updates.pageReady();
    setText(doc('./fast.json'));
    await updates.pageReady();
    release('SLOW');
    await slow;
    expect(sent).toEqual([expect.objectContaining({ text: 'FAST' })]);
  });

  it('answers a fetch of the offered URL, and refuses any other', async () => {
    const { impl } = fakeFetch({ 'https://x/s.json': { status: 200, body: '{}' } });
    const sent: unknown[] = [];
    const updates = new SchemaUpdates(new SchemaSession(files({}).io, impl), () => input({ documentText: doc('https://x/s.json') }), (p) => sent.push(p), 10);
    await updates.pageReady();
    expect(await updates.fetch('https://other/s.json')).toBe(false);
    expect(await updates.fetch('https://x/s.json')).toBe(true);
    expect(sent).toEqual([{ status: 'needsConsent', url: 'https://x/s.json' }, expect.objectContaining({ status: 'found' })]);
  });
});
