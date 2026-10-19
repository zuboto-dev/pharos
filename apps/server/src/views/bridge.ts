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
  // Captured before any script of the page runs, so the page can't change what the bridge uses.
  var apply = Reflect.apply;
  var defineProperty = Object.defineProperty;
  var getRandomValues = window.crypto && window.crypto.getRandomValues;
  var cryptoObject = window.crypto;
  var timeout = window.setTimeout;
  var clearTimer = window.clearTimeout;
  var URLClass = window.URL;
  var preventDefault = window.Event && window.Event.prototype.preventDefault;
  function cancel(event) {
    if (preventDefault) apply(preventDefault, event, []);
    else event.preventDefault();
  }
  var locationObject = window.location;
  var parentWindow = window.parent;
  var framed = parentWindow && parentWindow !== window;
  var initial = __PHAROS_THEME__;
  // A drawing in a report document (R14) may read only the names it lists; a page, any of its
  // own. A lookup table without a prototype, so the page can't widen it.
  var listed = __PHAROS_READS__;
  var allowed = null;
  if (listed) {
    allowed = Object.create(null);
    for (var k = 0; k < listed.length; k++) allowed[listed[k]] = true;
  }
  var theme =
    initial === 'dark' || initial === 'light'
      ? initial
      : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
  // Says which document sent a message: the parent answers only this one (not a page the frame
  // navigated to). Never given to the page's scripts.
  var token = (function () {
    var out = '';
    try {
      var bytes = new Uint8Array(16);
      apply(getRandomValues, cryptoObject, [bytes]);
      for (var i = 0; i < bytes.length; i++) out += (bytes[i] + 256).toString(16).slice(1);
    } catch (e) {
      for (var j = 0; j < 4; j++)
        out += ('0000000' + Math.floor(Math.random() * 0x100000000).toString(16)).slice(-8);
    }
    return out;
  })();
  var seq = 0;
  var pending = {};
  var asked = {};
  var dataListeners = [];
  var themeListeners = [];
  // Every message is built here as one literal: nothing the page defines runs while it is made.
  function send(kind, a, b) {
    if (!framed) return;
    var message =
      kind === 'data'
        ? { pharos: 1, token: token, kind: kind, id: a, name: b }
        : kind === 'openFile'
          ? { pharos: 1, token: token, kind: kind, fileId: a }
          : kind === 'link'
            ? { pharos: 1, token: token, kind: kind, url: a }
            : { pharos: 1, token: token, kind: kind };
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
      var timer = timeout(function () {
        delete pending[id];
        reject(new Error('Pharos did not answer pharos.data("' + name + '")'));
      }, 20000);
      pending[id] = { resolve: resolve, reject: reject, timer: timer };
      send('data', id, name);
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
  // A web address to open: http or https only, resolved against the page; null for anything else.
  function webAddress(raw) {
    try {
      var url = new URLClass(String(raw), locationObject.href);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      return url.href;
    } catch (e) {
      return null;
    }
  }
  // Opens a link through Pharos (a new tab, the reader sees where it goes); in a tab of its own
  // the page simply goes there.
  function openLink(raw) {
    var url = webAddress(raw);
    if (!url) return;
    if (framed) send('link', url);
    else {
      try {
        locationObject.assign(url);
      } catch (e) {}
    }
  }
  var api = {
    data: function (name) {
      name = String(name);
      if (allowed && allowed[name] !== true)
        return Promise.reject(
          new Error('This drawing does not list "' + name + '" in its reads'),
        );
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
      send('openFile', String(fileId));
    },
    openLink: function (url) {
      openLink(url);
    },
  };
  defineProperty(api, 'theme', {
    enumerable: true,
    get: function () {
      return theme;
    },
  });
  Object.freeze(api);
  defineProperty(window, 'pharos', { value: api, writable: false, configurable: false });
  setTheme(theme);
  window.addEventListener('message', function (event) {
    if (!framed || event.source !== parentWindow) return;
    var m = event.data;
    if (!m || typeof m !== 'object' || m.pharos !== 1) return;
    if (m.kind === 'data') {
      var p = pending[m.id];
      if (!p) return;
      delete pending[m.id];
      clearTimer(p.timer);
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
  if (framed) {
    // Links (sources) open through Pharos in a new tab: the frame may not open windows itself.
    // A link to a place in this page (#section) is left alone.
    var onClick = function (event) {
      if (event.type === 'auxclick' && event.button !== 1) return;
      var node = event.target;
      while (node && node.nodeType !== 1) node = node.parentNode;
      var link = node && node.closest ? node.closest('a[href], area[href]') : null;
      if (!link) return;
      var raw = link.getAttribute('href');
      if (raw === null) return;
      var url = webAddress(raw);
      if (!url) return;
      var here = String(locationObject.href).split('#')[0];
      if (raw.indexOf('#') >= 0 && url.split('#')[0] === here) return;
      cancel(event);
      send('link', url);
    };
    window.addEventListener('click', onClick, true);
    window.addEventListener('auxclick', onClick, true);
    // The page navigating its own frame can't be cancelled from inside (the Navigation API has
    // no events in an opaque origin): Pharos's own page refuses it (its frame-src) and the parent
    // stops the frame. Saying we are leaving lets the parent stop answering at once.
    var leaving = function () {
      send('leaving');
    };
    window.addEventListener('beforeunload', leaving);
    window.addEventListener('pagehide', leaving);
  }
  send('ready');
})();`;

export type PageTheme = 'light' | 'dark';

/**
 * The bridge for one document. `reads` (a drawing in a report document, R14) limits
 * `pharos.data` to those names: any other is refused in the frame and never asked of the parent.
 */
export function bridgeScript(theme?: PageTheme, reads?: string[]): string {
  // JSON inside a <script>: "<" escaped so a name can never close the tag.
  const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
  return BRIDGE_SCRIPT.replace('__PHAROS_THEME__', JSON.stringify(theme ?? null)).replace(
    '__PHAROS_READS__',
    json(reads ?? null),
  );
}

/** A doctype, after an optional byte-order mark, white space and comments. */
const DOCTYPE = /^\uFEFF?\s*(?:<!--[\s\S]*?-->\s*)*<!doctype[^>]*>/i;

/**
 * The page with the bridge as the first thing in the document: right after its doctype (so the
 * page keeps standards mode), or at the very start. The parser puts it in <head> either way,
 * before any script of the page, whether or not the page writes <html> and <head>.
 */
export function injectBridge(html: string, theme?: PageTheme, reads?: string[]): string {
  const tag = `<script>${bridgeScript(theme, reads)}</script>`;
  const doctype = DOCTYPE.exec(html);
  if (!doctype) return `${tag}${html}`;
  const at = doctype[0].length;
  return `${html.slice(0, at)}${tag}${html.slice(at)}`;
}
