import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@tvm/design/tokens.css';
import './app.css';
import { App } from './App';
import { startDesktopShell, startTvStage } from './tvStage';
import { applyPlanClass, fetchPlan, themeUnlocked } from './data/plan';
import { applyStoredTheme, applyTheme, readStoredTheme } from './theme/apply';

startTvStage();
startDesktopShell();
applyStoredTheme();
void fetchPlan().then((plan) => {
  applyPlanClass(plan);
  if (readStoredTheme() === 'synthwave' && !themeUnlocked(plan, 'synthwave')) applyTheme('default');
});

const container = document.getElementById('root');
if (container === null) throw new Error('TVM UI could not find #root');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
