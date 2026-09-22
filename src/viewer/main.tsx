import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { ErrorBoundary } from './components/ErrorBoundary.js'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root missing from index.html')

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary
      fallback={(error) => (
        <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif' }}>
          <h2>Flow Visualizer hit an error</h2>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{error.message}</pre>
          <button type="button" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      )}
    >
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
