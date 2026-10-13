import { configure } from '@testing-library/react';

// `findBy…` and `waitFor` wait up to 5s rather than 1s: while the server suite runs alongside, a
// page can take more than a second to render, which isn't a failure.
configure({ asyncUtilTimeout: 5_000 });
