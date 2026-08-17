import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@tvm/design/tokens.css';
import './app.css';
import { App } from './App';
import { startTvStage } from './tvStage';
import { applyPlanClass, fetchPlan } from './data/plan';

startTvStage();
void fetchPlan().then(applyPlanClass);

startTvStage();

const container = document.getElementById('root');
if (container === null) throw new Error('TVM UI could not find #root');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
