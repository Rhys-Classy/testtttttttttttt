import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { libraryConfig } from '../state/library';
import '../styles.css';
import './ipad.css';
import { IpadApp } from './IpadApp';

libraryConfig.tapToArm = true;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <IpadApp />
  </StrictMode>,
);
