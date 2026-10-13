import { Suspense, lazy, type ComponentType, type ReactNode } from 'react';
import { Skeleton } from './skeleton';

// Heavy catalog blocks load on first use (W11.6): charts, the gallery and lightbox, file
// previews, the explain blocks and the decision block live in their own chunks, so the first
// page load stays small. Until a block's chunk arrives its panel shows a calm skeleton. Once
// loaded (or preloaded, as the tests do), a block renders at once, without suspending again.

type Loaded<P> = ComponentType<P>;

const loaders: (() => Promise<void>)[] = [];

export function lazyBlock<P extends object>(
  load: () => Promise<Loaded<P>>,
  lines = 4,
): ((props: P) => ReactNode) & { preload: () => Promise<void> } {
  let loaded: Loaded<P> | undefined;
  let promise: Promise<void> | undefined;
  const preload = () =>
    (promise ??= load().then(
      (component) => {
        loaded = component;
      },
      (error: unknown) => {
        // A failed background fetch (e.g. offline) can be tried again; a block that fails while
        // showing falls to the renderer's error panel until the page is reloaded.
        promise = undefined;
        throw error;
      },
    ));
  loaders.push(preload);

  const Waiting = lazy(() => preload().then(() => ({ default: loaded! })));

  function LazyBlock(props: P) {
    const Block = loaded;
    if (Block) return <Block {...props} />;
    return (
      <Suspense fallback={<Skeleton lines={lines} />}>
        <Waiting {...props} />
      </Suspense>
    );
  }
  return Object.assign(LazyBlock, { preload });
}

/** Loads every lazy block now (tests, and idle time after the first page has shown). */
export function preloadBlocks(): Promise<void> {
  return Promise.all(loaders.map((l) => l())).then(() => undefined);
}
