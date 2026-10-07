import { useCallback, useEffect, useState } from 'react';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
  }
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body?.error?.message ?? `HTTP ${res.status}`,
      body?.error?.issues,
    );
  }
  return body as T;
}

type Common = {
  reload: () => void;
  /** Increments on every successful load. */
  version: number;
};

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.error?.message ?? `HTTP ${res.status}`,
      data?.error?.issues,
    );
  }
  return data as T;
}

export type Resource<T> = Common &
  (
    | { status: 'loading'; data?: undefined; error?: undefined }
    | { status: 'ok'; data: T; error?: undefined }
    | { status: 'error'; data?: T; error: Error }
  );

/**
 * Fetches JSON and refetches when the window regains focus, so changes made by agents show up
 * when you come back to the tab. Keeps showing the last data while refetching.
 */
export function useResource<T>(path: string | null): Resource<T> {
  const [state, setState] = useState<{
    path: string | null;
    data?: T;
    error?: Error;
    version: number;
  }>({
    path,
    version: 0,
  });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    getJson<T>(path).then(
      (data) => !cancelled && setState((s) => ({ path, data, version: s.version + 1 })),
      (error: Error) =>
        !cancelled &&
        setState((s) => ({
          path,
          data: s.path === path ? s.data : undefined,
          error,
          version: s.version,
        })),
    );
    return () => {
      cancelled = true;
    };
  }, [path, tick]);

  useEffect(() => {
    const onFocus = () => document.visibilityState === 'visible' && reload();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [reload]);

  const current = state.path === path ? state : { path, version: state.version };
  const common = { reload, version: current.version };
  if (current.error)
    return { status: 'error', data: current.data, error: current.error, ...common };
  if (current.data !== undefined) return { status: 'ok', data: current.data, ...common };
  return { status: 'loading', ...common };
}
