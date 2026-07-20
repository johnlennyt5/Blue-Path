import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { BUILD_TIME } from './lib/buildInfo';
import { plog } from './lib/debug';
import './index.css';

plog(`app booting · build ${BUILD_TIME} · ${window.location.href}`);

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
