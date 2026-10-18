/**
 * The bridge Pharos puts at the top of every report page (R13): it defines `window.pharos` and
 * talks to the Pharos page around the frame with `postMessage`, nothing else. The messages are
 * listed under "Bridge messages" in docs/reframe/r13-report-pages.md; the web app's side must
 * match them exactly.
 *
 * Plain ES5-ish JavaScript in a string: it runs before any script of the page, in a sandboxed
 * frame with an opaque origin, so it can't import anything and must never throw.
 */
export const BRIDGE_SCRIPT = String.raw`(function () {
  'use strict';
  var parentWindow = window.parent;
  var framed = parentWindow && parentWindow !== window;
  var initial = __PHAROS_THEME__;
  var theme =
    initial === 'dark' || initial === 'light'
      ? initial
      : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
  var seq = 0;
  var pending = {};
  var asked = {};
  var dataListeners = [];
  var themeListeners = [];
  function send(message) {
    if (!framed) return;
    message.pharos = 1;
    try {
      parentWindow.postMessage(message, '*');
    } catch (e) {}
  }
  function setTheme(next) {
    theme = next;
    try {
      document.documentElement.setAttribute('data-theme', next);
    } catch (e) {}
  }
  function call(list, value) {
    list.slice().forEach(function (cb) {
      try {
        cb(value);
      } catch (e) {
        if (window.console) console.error(e);
      }
    });
  }
  function ask(name) {
    return new Promise(function (resolve, reject) {
      if (!framed) {
        reject(new Error('Live data comes from Pharos: open this page in Pharos to see it'));
        return;
      }
      var id = 'r' + ++seq;
      var timer = setTimeout(function () {
        delete pending[id];
        reject(new Error('Pharos did not answer pharos.data("' + name + '")'));
      }, 20000);
      pending[id] = { resolve: resolve, reject: reject, timer: timer };
      send({ kind: 'data', id: id, name: name });
    });
  }
  function refresh() {
    var names = Object.keys(asked);
    Promise.all(
      names.map(function (name) {
        return ask(name).then(
          function (rows) {
            return [name, rows];
          },
          function () {
            return null;
          },
        );
      }),
    ).then(function (pairs) {
      var fresh = {};
      pairs.forEach(function (pair) {
        if (pair) fresh[pair[0]] = pair[1];
      });
      call(dataListeners, fresh);
    });
  }
  var api = {
    data: function (name) {
      name = String(name);
      asked[name] = true;
      return ask(name);
    },
    onData: function (cb) {
      if (typeof cb === 'function') dataListeners.push(cb);
    },
    onTheme: function (cb) {
      if (typeof cb === 'function') themeListeners.push(cb);
    },
    openFile: function (fileId) {
      send({ kind: 'openFile', fileId: String(fileId) });
    },
  };
  Object.defineProperty(api, 'theme', {
    enumerable: true,
    get: function () {
      return theme;
    },
  });
  Object.freeze(api);
  Object.defineProperty(window, 'pharos', { value: api, writable: false, configurable: false });
  setTheme(theme);
  window.addEventListener('message', function (event) {
    if (!framed || event.source !== parentWindow) return;
    var m = event.data;
    if (!m || typeof m !== 'object' || m.pharos !== 1) return;
    if (m.kind === 'data') {
      var p = pending[m.id];
      if (!p) return;
      delete pending[m.id];
      clearTimeout(p.timer);
      if (m.error) p.reject(new Error(String(m.error)));
      else p.resolve(Array.isArray(m.rows) ? m.rows : []);
    } else if (m.kind === 'changed') {
      refresh();
    } else if (m.kind === 'theme' && (m.theme === 'light' || m.theme === 'dark')) {
      if (m.theme === theme) return;
      setTheme(m.theme);
      call(themeListeners, m.theme);
    }
  });
  send({ kind: 'ready' });
})();`;

export type PageTheme = 'light' | 'dark';

export function bridgeScript(theme?: PageTheme): string {
  return BRIDGE_SCRIPT.replace('__PHAROS_THEME__', JSON.stringify(theme ?? null));
}

/** A doctype, after an optional byte-order mark, white space and comments. */
const DOCTYPE = /^\uFEFF?\s*(?:<!--[\s\S]*?-->\s*)*<!doctype[^>]*>/i;

/**
 * The page with the bridge as the first thing in the document: right after its doctype (so the
 * page keeps standards mode), or at the very start. The parser puts it in <head> either way,
 * before any script of the page, whether or not the page writes <html> and <head>.
 */
export function injectBridge(html: string, theme?: PageTheme): string {
  const tag = `<script>${bridgeScript(theme)}</script>`;
  const doctype = DOCTYPE.exec(html);
  if (!doctype) return `${tag}${html}`;
  const at = doctype[0].length;
  return `${html.slice(0, at)}${tag}${html.slice(at)}`;
}
