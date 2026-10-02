import { describe, expect, it } from 'vitest';
import { OutgoingMessage } from './bridge';
import { DocumentSync, keepFinalNewline, normalizeEol, SyncHost } from './documentSync';

// A TextDocument stand-in that, like VS Code, fires the change event while
// an edit is applied and stores text with the file's own line endings.
function fakeHost(initial: string, eol: '\n' | '\r\n' = '\n') {
  let text = initial;
  const posted: OutgoingMessage[] = [];
  const warnings: string[] = [];
  let sync: DocumentSync;
  let refuse = false;
  const host: SyncHost = {
    getText: () => text,
    replaceText: async (next) => {
      if (refuse) return false;
      text = normalizeEol(next).replace(/\n/g, eol);
      sync.onDocumentChanged();
      return true;
    },
    post: (m) => posted.push(m),
    warn: (m) => warnings.push(m),
  };
  return {
    posted,
    warnings,
    attach: (s: DocumentSync) => (sync = s),
    externalEdit: (next: string) => {
      text = next;
      sync.onDocumentChanged();
    },
    refuseEdits: () => (refuse = true),
    get text() {
      return text;
    },
    host,
  };
}

function setUp(initial: string, opts: { eol?: '\n' | '\r\n'; readOnly?: boolean } = {}) {
  const fake = fakeHost(initial, opts.eol);
  const sync = new DocumentSync(fake.host, 'a.json', opts.readOnly ?? false);
  fake.attach(sync);
  sync.onPageReady();
  fake.posted.length = 0;
  return { fake, sync };
}

describe('DocumentSync', () => {
  it('sends the document on READY', () => {
    const fake = fakeHost('{"a": 1}\n');
    const sync = new DocumentSync(fake.host, 'a.json', true);
    fake.attach(sync);
    sync.onPageReady();
    expect(fake.posted).toEqual([
      { type: 'LOAD_DOCUMENT', payload: { fileName: 'a.json', text: '{"a": 1}\n', readOnly: true } },
    ]);
  });

  it('writes a page edit into the document without echoing it back', async () => {
    const { fake, sync } = setUp('{}');
    await sync.onPageEdit('{\n  "a": 1\n}');
    expect(fake.text).toBe('{\n  "a": 1\n}');
    expect(fake.posted).toEqual([]);
  });

  it('does not echo back when the file uses CRLF', async () => {
    const { fake, sync } = setUp('{}\r\n', { eol: '\r\n' });
    await sync.onPageEdit('{\n  "a": 1\n}');
    expect(fake.text).toBe('{\r\n  "a": 1\r\n}\r\n');
    expect(fake.posted).toEqual([]);
  });

  it("keeps the file's final newline", async () => {
    const { fake, sync } = setUp('{}\n');
    await sync.onPageEdit('[]');
    expect(fake.text).toBe('[]\n');
  });

  it('skips an edit that changes nothing', async () => {
    const { fake, sync } = setUp('{\n  "a": 1\n}\n');
    let writes = 0;
    const replace = fake.host.replaceText;
    fake.host.replaceText = (t) => (writes++, replace(t));
    await sync.onPageEdit('{\n  "a": 1\n}');
    expect(writes).toBe(0);
  });

  it('forwards a change made elsewhere as EXTERNAL_RELOAD', () => {
    const { fake } = setUp('{}');
    fake.externalEdit('{"b": 2}');
    expect(fake.posted).toEqual([{ type: 'EXTERNAL_RELOAD', payload: { text: '{"b": 2}' } }]);
  });

  it('forwards an undo of a page edit', async () => {
    const { fake, sync } = setUp('{}');
    await sync.onPageEdit('[1]');
    fake.externalEdit('{}');
    expect(fake.posted).toEqual([{ type: 'EXTERNAL_RELOAD', payload: { text: '{}' } }]);
  });

  it('ignores change events that leave the text as it was (e.g. save)', () => {
    const { fake, sync } = setUp('{}');
    sync.onDocumentChanged();
    expect(fake.posted).toEqual([]);
  });

  it('ignores page edits on a read-only file', async () => {
    const { fake, sync } = setUp('{}', { readOnly: true });
    await sync.onPageEdit('[1]');
    expect(fake.text).toBe('{}');
    expect(fake.warnings.length).toBe(1);
  });

  it('puts the page back on the file when the edit cannot be applied', async () => {
    const { fake, sync } = setUp('{}');
    fake.refuseEdits();
    await sync.onPageEdit('[1]');
    expect(fake.text).toBe('{}');
    expect(fake.posted).toEqual([{ type: 'EXTERNAL_RELOAD', payload: { text: '{}' } }]);
    expect(fake.warnings.length).toBe(1);
  });
});

describe('keepFinalNewline', () => {
  it('adds one only when the file had one and the new text lacks it', () => {
    expect(keepFinalNewline('{}\n', '[]')).toBe('[]\n');
    expect(keepFinalNewline('{}\r\n', '[]')).toBe('[]\n');
    expect(keepFinalNewline('{}', '[]')).toBe('[]');
    expect(keepFinalNewline('{}\n', '[]\n')).toBe('[]\n');
  });
});
