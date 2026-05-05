import React from 'react';

interface State { hasError: boolean }

export class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh',
          background: '#1a1a2e', color: '#e2e8f0', fontFamily: 'sans-serif', gap: 16,
        }}>
          <div style={{ fontSize: 64 }}>🤖</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#a78bfa' }}>Oops! Something went wrong.</div>
          <div style={{ fontSize: 15, color: '#94a3b8' }}>Press the button below to try again!</div>
          <button
            onClick={() => this.setState({ hasError: false })}
            style={{
              marginTop: 8, padding: '10px 28px', background: '#7c3aed',
              color: 'white', border: 'none', borderRadius: 10,
              fontSize: 16, fontWeight: 700, cursor: 'pointer',
            }}
          >
            🔄 Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
