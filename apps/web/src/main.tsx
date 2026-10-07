import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import { AppShell } from './pages/AppShell';
import { HomePage } from './pages/HomePage';
import { ProjectPage } from './pages/ProjectPage';
import { SettingsPage } from './pages/SettingsPage';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="projects/:projectId" element={<ProjectPage />} />
          <Route path="projects/:projectId/views/:viewId" element={<ProjectPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
