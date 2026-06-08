import React from 'react';
import { createRoot } from 'react-dom/client';
import { SidePanelApp } from './App';
import { ToastProvider } from '@/components/ErrorToast';
import '@/style.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <ToastProvider>
        <SidePanelApp />
      </ToastProvider>
    </React.StrictMode>,
  );
}
