import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('[EdicolaGiuridica] React crash:', error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: '#0F1114', color: '#E8E4DD', fontFamily: 'Georgia, serif',
          padding: '24px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 36, marginBottom: 16 }}>⚖️</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#C8A96E', marginBottom: 12 }}>
            Edicola Giuridica
          </h1>
          <p style={{ fontSize: 14, color: '#8A8680', maxWidth: 420, lineHeight: 1.6, marginBottom: 20 }}>
            Si è verificato un errore imprevisto. Ricarica la pagina per riprovare.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: '#C8A96E', color: '#000', border: 'none',
              borderRadius: 6, padding: '10px 24px', fontSize: 14,
              fontWeight: 700, cursor: 'pointer',
            }}
          >
            Ricarica
          </button>
          {this.state.error && (
            <pre style={{
              marginTop: 24, padding: 16, background: '#1A1D23',
              borderRadius: 8, fontSize: 11, color: '#C45C5C',
              maxWidth: 700, width: '100%', overflow: 'auto', textAlign: 'left',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {this.state.error.message}{'\n\n'}{this.state.error.stack}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
