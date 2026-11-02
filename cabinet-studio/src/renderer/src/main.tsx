import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  // No StrictMode: its double-mounted effects would create two GPU devices on one canvas.
  <App />,
);
