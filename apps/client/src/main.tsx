import './index.css';
// Module registration barrel: importing it registers every module's renderer
// (import-time side effect) before anything renders. See modules/index.ts.
import './modules/index.js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
