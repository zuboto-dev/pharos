import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import { AppShell } from './pages/AppShell';
import { HomePage } from './pages/HomePage';
import { ProjectPage } from './pages/ProjectPage';
import { SettingsPage } from './pages/SettingsPage';
import { preloadBlocks } from './catalog/lazy-block';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="projects/:projectId" element={<ProjectPage />} />
          <Route path="projects/:projectId/views/:viewId" element={<ProjectPage />} />
          <Route path="projects/:projectId/files" element={<ProjectPage page="files" />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);

// Once the first page has shown, fetch the heavy blocks in the background (W11.6), so opening a
// page with a chart or a gallery later doesn't wait. A failed fetch is tried again on first use.
const idle = window.requestIdleCallback ?? ((fn: () => void) => window.setTimeout(fn, 2000));
idle(() => {
  preloadBlocks().catch(() => undefined);
});
