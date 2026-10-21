/**
 * Who may open the agent terminal (R17): only the owner, at this computer. The panel runs a real
 * agent CLI with the owner's account, so it is stricter than the app's local-only guard, which
 * also lets the owner's hosted address (PHAROS_WEB_URL behind a tunnel with a login) in.
 */

export const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Headers a proxy or tunnel adds: a request carrying one didn't come straight from this computer. */
const PROXY_HEADERS = [
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-real-ip',
  'cf-connecting-ip',
  'true-client-ip',
];

export type TerminalRefusal = {
  /** agent: an agent author; hosted: not this computer's address; origin: not this server's page. */
  code: 'agent' | 'hosted' | 'origin';
  message: string;
};

type Header = (name: string) => string | undefined;

function hostOf(value: string): { hostname: string; host: string } | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(`http://${value}`);
    return { hostname: url.hostname, host: url.host };
  } catch {
    return undefined;
  }
}

const HOSTED: TerminalRefusal = {
  code: 'hosted',
  message: 'The agent terminal works only on this computer',
};

/**
 * Where the request is from, without the Origin check (the status route: a same-origin GET may
 * come without Origin). Refuses an agent author, a proxied request, and any non-local Host.
 */
export function terminalPlaceRefusal(header: Header): TerminalRefusal | undefined {
  const author = header('x-pharos-author');
  if (author !== undefined && author.split(':')[0] !== 'human')
    return { code: 'agent', message: 'Agents can’t open the owner’s terminal' };
  if (PROXY_HEADERS.some((name) => header(name) !== undefined)) return HOSTED;
  const host = hostOf(header('host') ?? '');
  if (!host || !LOCAL_HOSTS.has(host.hostname)) return HOSTED;
  return undefined;
}

/**
 * The terminal socket: the place checks above, and an Origin that is a local page of this very
 * server (the same host and port as the request's Host). A browser always sends Origin on a
 * WebSocket, so a missing one is refused; so is any other local site (another port).
 */
export function terminalSocketRefusal(header: Header): TerminalRefusal | undefined {
  const place = terminalPlaceRefusal(header);
  if (place) return place;
  const host = hostOf(header('host') ?? '');
  try {
    const url = new URL(header('origin') ?? '');
    if (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      LOCAL_HOSTS.has(url.hostname) &&
      url.host === host?.host
    )
      return undefined;
  } catch {
    // Missing or malformed: refused below.
  }
  return { code: 'origin', message: 'Only a Pharos page on this computer opens the terminal' };
}
