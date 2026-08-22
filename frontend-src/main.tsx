import React from 'react';
import { createRoot } from 'react-dom/client';
import { WorldMarketplace } from '../app/world-marketplace';
import '../app/globals.css';

const root = document.getElementById('root');
if (!root) throw new Error('Frontend root element is missing');

createRoot(root).render(
  <React.StrictMode>
    <WorldMarketplace />
  </React.StrictMode>,
);
