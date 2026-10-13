import { preloadBlocks } from './src/catalog/lazy-block';
import './src/catalog/components/index';
import { configure } from '@testing-library/react';

// `findBy…` and `waitFor` wait up to 5s rather than 1s: while the server suite runs alongside, a
// page can take more than a second to render, which isn't a failure.
configure({ asyncUtilTimeout: 5_000 });

// Heavy catalog blocks load on first use in the app (W11.6); tests load them all up front, so a
// render shows them at once, as before.
await preloadBlocks();
