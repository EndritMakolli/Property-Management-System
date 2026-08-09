import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

const buttonStyle = {
  padding: '7px 14px',
  border: '1px solid rgba(128,128,128,0.4)',
  borderRadius: 8,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  font: 'inherit',
} as const

// Catches render-time crashes in the routed page so a single broken page shows
// a recoverable panel instead of unmounting the whole app (white screen).
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page crashed:', error, info.componentStack)
  }

  handleRetry = () => {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      // Styled inline rather than with global classes: this renders inside both
      // the staff shell and the guest site, which load different stylesheets.
      return (
        <section
          style={{
            margin: 18,
            padding: 24,
            border: '1px solid rgba(128,128,128,0.3)',
            borderRadius: 10,
            maxWidth: 620,
          }}
        >
          <h3 style={{ marginTop: 0 }}>Something went wrong on this page</h3>
          <p style={{ opacity: 0.75 }}>
            {this.state.error.message || 'An unexpected error occurred while rendering.'}
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button style={buttonStyle} onClick={this.handleRetry} type="button">
              Try again
            </button>
            <button style={buttonStyle} onClick={() => window.location.reload()} type="button">
              Reload app
            </button>
          </div>
        </section>
      )
    }
    return this.props.children
  }
}
