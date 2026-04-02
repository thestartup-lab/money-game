import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// React 渲染完成後移除載入畫面
if (typeof (window as Window & { __hideSplash?: () => void }).__hideSplash === 'function') {
  (window as Window & { __hideSplash?: () => void }).__hideSplash!();
}
