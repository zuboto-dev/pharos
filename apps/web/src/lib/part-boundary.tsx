import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { BUTTON } from '../catalog/ui';

// A part of the app that failed shows a short message in its place, and the rest stays up: an
// error anywhere used to blank the whole page (Chaeeon, 10-23: clicking the terminal quickly left a
// white page). Every caught error goes to the server log, so it can be traced afterwards.

/** Sends what failed to the server log (best effort, never throws). */
export function reportClientError(part: string, error: unknown, componentStack?: string | null) {
  try {
    const e = error instanceof Error ? error : new Error(String(error));
    void fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pharos-author': 'human:me' },
      body: JSON.stringify({
        part,
        message: e.message.slice(0, 500),
        stack: (e.stack ?? '').slice(0, 3000),
        componentStack: (componentStack ?? '').slice(0, 3000),
        url: location.pathname + location.search,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Reporting must never be the second failure.
  }
}

type Props = { part: string; children: ReactNode; whole?: boolean };

export class PartBoundary extends Component<Props, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    reportClientError(this.props.part, error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        data-part-error={this.props.part}
        className={
          this.props.whole
            ? 'mx-auto mt-24 max-w-md space-y-3 p-6 text-center'
            : 'm-4 space-y-3 rounded-tile border border-line bg-surface p-4'
        }
      >
        <p className="flex items-center justify-center gap-2 text-sm font-medium text-ink">
          <AlertTriangle aria-hidden className="size-4 text-warn" />
          {this.props.whole ? 'Pharos hit an error' : `The ${this.props.part} hit an error`}
        </p>
        <p className="text-xs text-muted">It was logged for a fix. Nothing you saved is lost.</p>
        <div className="flex justify-center gap-2">
          {!this.props.whole && (
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className={BUTTON.secondary}
            >
              <RotateCcw aria-hidden className="size-3.5" /> Try again
            </button>
          )}
          <button type="button" onClick={() => location.reload()} className={BUTTON.secondary}>
            Reload the page
          </button>
        </div>
      </div>
    );
  }
}
