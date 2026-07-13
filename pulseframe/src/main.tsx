import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// No StrictMode on purpose: the WebGL engine's lifecycle is managed manually
// and dev double-mounting would create/destroy GPU contexts for no benefit.
createRoot(document.getElementById('root')!).render(<App />);
