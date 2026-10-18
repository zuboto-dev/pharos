import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { bridgeScript, injectBridge } from './bridge.js';

// R13: the bridge in every report page. It runs here in a vm with a stand-in window: a parent
// that records postMessage, and message events dispatched with a chosen source.

type Message = Record<string, unknown>;

const PAGE_URL = 'http://127.0.0.1:4300/api/views/view_1/page/?v=1';

/**
 * Events as a browser makes them, a fresh class for each frame so a page patching its prototype
 * changes only its own.
 */
function eventClass() {
  return class Event {
    defaultPrevented = false;
    constructor(
      readonly type: string,
      init: Record<string, unknown> = {},
    ) {
      Object.assign(this, init);
    }
    preventDefault() {
      this.defaultPrevented = true;
    }
  };
}
const FakeEvent = eventClass();

type Listener = (event: never) => void;

function frame(
  options: {
    framed?: boolean;
    theme?: 'light' | 'dark';
    prefersDark?: boolean;
    crypto?: boolean;
  } = {},
) {
  const Event = eventClass();
  const listeners: Record<string, Listener[]> = {};
  const posted: Message[] = [];
  const attrs: Record<string, string> = {};
  const assigned: string[] = [];
  const parent = {
    postMessage: (message: Message, origin: string) => posted.push({ ...message, origin }),
  };
  const win: Record<string, unknown> = {
    addEventListener: (type: string, fn: Listener) => {
      (listeners[type] ??= []).push(fn);
    },
    setTimeout,
    clearTimeout,
    console,
    URL,
    crypto: options.crypto === false ? undefined : globalThis.crypto,
    Event,
    location: { href: PAGE_URL, assign: (url: string) => assigned.push(url) },
    matchMedia: () => ({ matches: !!options.prefersDark }),
    document: { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } },
  };
  win.window = win;
  win.parent = options.framed === false ? win : parent;
  vm.createContext(win);
  vm.runInContext(bridgeScript(options.theme), win);
  const fire = (type: string, event: unknown) =>
    (listeners[type] ?? []).forEach((fn) => fn(event as never));
  const dispatch = (data: unknown, source: unknown = parent) => fire('message', { data, source });
  /** A click on an element inside `<a href=…>` (or on nothing link-like when href is null). */
  const click = (href: string | null, init: Record<string, unknown> = {}) => {
    const link = href === null ? null : { getAttribute: () => href };
    const event = new Event(String(init.type ?? 'click'), {
      button: 0,
      target: { nodeType: 1, closest: () => link },
      ...init,
    });
    fire(event.type, event);
    return event;
  };
  const pharos = win.pharos as {
    theme: string;
    data: (name: string) => Promise<unknown[]>;
    onData: (cb: (fresh: Record<string, unknown[]>) => void) => void;
    onTheme: (cb: (theme: string) => void) => void;
    openFile: (id: string) => void;
    openLink: (url: string) => void;
  };
  return { win, pharos, posted, attrs, dispatch, parent, click, fire, assigned };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const TOKEN = expect.stringMatching(/^[0-9a-f]{32}$/);

describe('the report page bridge (R13)', () => {
  it('says ready, and sets the theme from the page address or the system', () => {
    const f = frame({ theme: 'dark' });
    expect(f.posted).toEqual([{ pharos: 1, kind: 'ready', token: TOKEN, origin: '*' }]);
    expect(f.pharos.theme).toBe('dark');
    expect(f.attrs['data-theme']).toBe('dark');
    expect(frame({ prefersDark: true }).pharos.theme).toBe('dark');
    expect(frame().attrs['data-theme']).toBe('light');
  });

  it('asks the parent for named rows and resolves with its answer', async () => {
    const f = frame();
    const rows = f.pharos.data('spend');
    const ask = f.posted.at(-1)!;
    expect(ask).toMatchObject({ pharos: 1, kind: 'data', name: 'spend' });
    expect(typeof ask.id).toBe('string');
    f.dispatch({ pharos: 1, kind: 'data', id: ask.id, name: 'spend', rows: [{ id: 'rec_1' }] });
    expect(await rows).toEqual([{ id: 'rec_1' }]);
    const failing = f.pharos.data('nope');
    f.dispatch({
      pharos: 1,
      kind: 'data',
      id: f.posted.at(-1)!.id,
      name: 'nope',
      rows: [],
      error: 'Unknown read "nope"',
    });
    await expect(failing).rejects.toThrow('Unknown read "nope"');
  });

  it('accepts messages only from its parent, and only Pharos ones', async () => {
    const f = frame();
    const rows = f.pharos.data('spend');
    const id = f.posted.at(-1)!.id;
    let settled = false;
    void rows.then(() => (settled = true));
    f.dispatch({ pharos: 1, kind: 'data', id, rows: ['forged'] }, {});
    f.dispatch({ pharos: 1, kind: 'data', id, rows: ['forged'] }, f.win);
    f.dispatch({ pharos: 1, kind: 'theme', theme: 'dark' }, {});
    f.dispatch({ kind: 'data', id, rows: ['no pharos'] });
    f.dispatch('a string');
    f.dispatch(null);
    await tick();
    expect(settled).toBe(false);
    expect(f.pharos.theme).toBe('light');
    f.dispatch({ pharos: 1, kind: 'data', id, rows: ['real'] });
    expect(await rows).toEqual(['real']);
  });

  it('on "changed", asks again for every read it asked for and calls onData once', async () => {
    const f = frame();
    const seen: Record<string, unknown[]>[] = [];
    f.pharos.onData((fresh) => seen.push(fresh));
    for (const name of ['a', 'b']) {
      const p = f.pharos.data(name);
      f.dispatch({ pharos: 1, kind: 'data', id: f.posted.at(-1)!.id, name, rows: [1] });
      await p;
    }
    const before = f.posted.length;
    f.dispatch({ pharos: 1, kind: 'changed' });
    const asks = f.posted.slice(before);
    expect(asks.map((m) => [m.kind, m.name])).toEqual([
      ['data', 'a'],
      ['data', 'b'],
    ]);
    for (const m of asks)
      f.dispatch({ pharos: 1, kind: 'data', id: m.id, name: m.name, rows: [2] });
    await tick();
    await tick();
    expect(seen).toEqual([{ a: [2], b: [2] }]);
  });

  it('follows theme messages and tells onTheme; opens files through the parent', () => {
    const f = frame();
    const themes: string[] = [];
    f.pharos.onTheme((t) => themes.push(t));
    f.dispatch({ pharos: 1, kind: 'theme', theme: 'dark' });
    f.dispatch({ pharos: 1, kind: 'theme', theme: 'dark' });
    f.dispatch({ pharos: 1, kind: 'theme', theme: 'purple' });
    expect(themes).toEqual(['dark']);
    expect(f.attrs['data-theme']).toBe('dark');
    expect(f.pharos.theme).toBe('dark');
    f.pharos.openFile('file_1');
    expect(f.posted.at(-1)).toEqual({
      pharos: 1,
      kind: 'openFile',
      fileId: 'file_1',
      token: f.posted[0]!.token,
      origin: '*',
    });
  });

  it("can't be replaced by the page, and explains itself outside Pharos", async () => {
    const f = frame();
    expect(() => vm.runInContext('"use strict"; window.pharos = {}', f.win)).toThrow();
    expect(() => vm.runInContext('"use strict"; window.pharos.data = null', f.win)).toThrow();
    const alone = frame({ framed: false });
    expect(alone.posted).toEqual([]);
    await expect(alone.pharos.data('spend')).rejects.toThrow(/open this page in Pharos/);
  });
});

describe('injecting the bridge (R13)', () => {
  const tag = '<script>(function () {';
  it('goes right after the doctype, or first when there is none', () => {
    expect(
      injectBridge('<!doctype html><html><head><script>x</script>').startsWith(
        `<!doctype html>${tag}`,
      ),
    ).toBe(true);
    expect(
      injectBridge('<!-- hi -->\n<!DOCTYPE html>\n<p>').startsWith(
        `<!-- hi -->\n<!DOCTYPE html>${tag}`,
      ),
    ).toBe(true);
    expect(injectBridge('<html><script>x</script>').startsWith(tag)).toBe(true);
    expect(injectBridge('<p>no head</p>').startsWith(tag)).toBe(true);
    expect(injectBridge('\uFEFF<!doctype html><p>').startsWith(`\uFEFF<!doctype html>${tag}`)).toBe(
      true,
    );
  });

  it('comes before every script of the page', () => {
    const html = injectBridge(
      '<!doctype html><script>page()</script><head><script>more()</script>',
    );
    expect(html.indexOf(tag)).toBeLessThan(html.indexOf('page()'));
    // The bridge never closes its own script tag early.
    expect(bridgeScript('dark').toLowerCase()).not.toContain('</script');
  });
});

describe('the bridge keeps the page in Pharos (R13.6)', () => {
  it('signs every message with one token the page never sees', () => {
    const f = frame();
    const token = f.posted[0]!.token as string;
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(frame().posted[0]!.token).not.toBe(token);
    // Without crypto it still makes one.
    expect(frame({ crypto: false }).posted[0]!.token).toMatch(/^[0-9a-f]{32}$/);
    void f.pharos.data('a');
    f.pharos.openFile('file_1');
    f.pharos.openLink('https://example.org/');
    expect(f.posted.map((m) => m.token)).toEqual([token, token, token, token]);
    expect(Object.keys(f.pharos).sort()).toEqual(
      ['data', 'onData', 'onTheme', 'openFile', 'openLink', 'theme'].sort(),
    );
    expect(JSON.stringify(f.pharos)).not.toContain(token);
  });

  it("can't be read through setters the page puts on Object.prototype", () => {
    const f = frame();
    vm.runInContext(
      `window.caught = [];
       for (const key of ['pharos', 'token', 'kind', 'id', 'name', 'url', 'fileId'])
         Object.defineProperty(Object.prototype, key, {
           set(v) { window.caught.push(this); },
           configurable: true,
         });`,
      f.win,
    );
    void f.pharos.data('a');
    f.pharos.openFile('file_1');
    f.pharos.openLink('https://example.org/');
    f.click('https://example.org/x');
    expect((f.win.caught as unknown[]).length).toBe(0);
    expect(f.posted.slice(1).every((m) => m.token === f.posted[0]!.token)).toBe(true);
  });

  it('sends clicks on web links to Pharos instead of following them', () => {
    const f = frame();
    const before = f.posted.length;
    const plain = f.click('https://example.org/report');
    expect(plain.defaultPrevented).toBe(true);
    const relative = f.click('../other.png');
    expect(relative.defaultPrevented).toBe(true);
    const middle = f.click('https://example.org/m', { type: 'auxclick', button: 1 });
    expect(middle.defaultPrevented).toBe(true);
    // Right clicks, links in the page itself and other schemes are left alone.
    expect(f.click('https://example.org/r', { type: 'auxclick', button: 2 }).defaultPrevented).toBe(
      false,
    );
    expect(f.click('#section').defaultPrevented).toBe(false);
    expect(f.click('?v=1#section').defaultPrevented).toBe(false);
    expect(f.click('mailto:me@example.org').defaultPrevented).toBe(false);
    expect(f.click('javascript:alert(1)').defaultPrevented).toBe(false);
    expect(f.click(null).defaultPrevented).toBe(false);
    expect(f.posted.slice(before).map((m) => [m.kind, m.url])).toEqual([
      ['link', 'https://example.org/report'],
      ['link', 'http://127.0.0.1:4300/api/views/view_1/other.png'],
      ['link', 'https://example.org/m'],
    ]);
    f.pharos.openLink('ftp://example.org/x');
    f.pharos.openLink('not a url at all ::');
    expect(f.posted.at(-1)!.kind).toBe('link');
    expect(f.posted.length).toBe(before + 4);
    expect(f.posted.at(-1)!.url).toBe(
      'http://127.0.0.1:4300/api/views/view_1/page/not%20a%20url%20at%20all%20::',
    );
  });

  it('says it is leaving when the document unloads', () => {
    const f = frame();
    f.fire('beforeunload', new FakeEvent('beforeunload'));
    f.fire('pagehide', new FakeEvent('pagehide'));
    expect(f.posted.slice(-2).map((m) => [m.kind, m.token])).toEqual([
      ['leaving', f.posted[0]!.token],
      ['leaving', f.posted[0]!.token],
    ]);
  });

  it('in a tab of its own, follows links itself and posts nothing', () => {
    const f = frame({ framed: false });
    f.pharos.openLink('https://example.org/a');
    f.pharos.openLink('javascript:alert(1)');
    expect(f.assigned).toEqual(['https://example.org/a']);
    expect(f.click('https://example.org/b').defaultPrevented).toBe(false);
    expect(f.posted).toEqual([]);
  });

  it("can't be talked out of catching a link by a page that patches Event.prototype", () => {
    const f = frame();
    vm.runInContext('Event.prototype.preventDefault = function () {};', f.win);
    expect(f.click('https://evil.example/?d=1').defaultPrevented).toBe(true);
    expect(f.posted.at(-1)).toMatchObject({ kind: 'link', url: 'https://evil.example/?d=1' });
  });
});
