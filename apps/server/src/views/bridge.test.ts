import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { bridgeScript, injectBridge } from './bridge.js';

// R13: the bridge in every report page. It runs here in a vm with a stand-in window: a parent
// that records postMessage, and message events dispatched with a chosen source.

type Message = Record<string, unknown>;

function frame(
  options: { framed?: boolean; theme?: 'light' | 'dark'; prefersDark?: boolean } = {},
) {
  const listeners: ((event: { data: unknown; source: unknown }) => void)[] = [];
  const posted: Message[] = [];
  const attrs: Record<string, string> = {};
  const parent = {
    postMessage: (message: Message, origin: string) => posted.push({ ...message, origin }),
  };
  const win: Record<string, unknown> = {
    addEventListener: (type: string, fn: (event: { data: unknown; source: unknown }) => void) => {
      if (type === 'message') listeners.push(fn);
    },
    setTimeout,
    clearTimeout,
    console,
    matchMedia: () => ({ matches: !!options.prefersDark }),
    document: { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } },
  };
  win.window = win;
  win.parent = options.framed === false ? win : parent;
  vm.createContext(win);
  vm.runInContext(bridgeScript(options.theme), win);
  const dispatch = (data: unknown, source: unknown = parent) =>
    listeners.forEach((fn) => fn({ data, source }));
  const pharos = win.pharos as {
    theme: string;
    data: (name: string) => Promise<unknown[]>;
    onData: (cb: (fresh: Record<string, unknown[]>) => void) => void;
    onTheme: (cb: (theme: string) => void) => void;
    openFile: (id: string) => void;
  };
  return { win, pharos, posted, attrs, dispatch, parent };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('the report page bridge (R13)', () => {
  it('says ready, and sets the theme from the page address or the system', () => {
    const f = frame({ theme: 'dark' });
    expect(f.posted).toEqual([{ pharos: 1, kind: 'ready', origin: '*' }]);
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
    expect(f.posted.at(-1)).toEqual({ pharos: 1, kind: 'openFile', fileId: 'file_1', origin: '*' });
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
