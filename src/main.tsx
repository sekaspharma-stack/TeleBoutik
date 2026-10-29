import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// iOS Safari n'applique :active (retour tactile) que si un écouteur touch existe sur le document.
document.addEventListener('touchstart', () => undefined, { passive: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
