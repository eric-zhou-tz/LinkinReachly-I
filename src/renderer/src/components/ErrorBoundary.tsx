import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }

type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[renderer]', error, info.componentStack)
    // Report to main process for server-side error collection
    try {
      const loa = (window as unknown as Record<string, unknown>).loa as { trackEvent?: (name: string, props: Record<string, unknown>) => void } | undefined
      loa?.trackEvent?.('Error Reported', {
        error_category: 'renderer_crash',
        error_message: (error.message || String(error)).slice(0, 500),
        error_severity: 'error',
        component_stack: (info.componentStack || '').slice(0, 1000),
        stack: (error.stack || '').slice(0, 2000),
      })
    } catch { /* best effort */ }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app-shell error-boundary" role="alert">
          <h1>Something went wrong in this panel</h1>
          <p>
            Try reloading the window. If it keeps happening, check the
            developer console or logs folder (Setup → Open logs folder).
          </p>
          <pre>Error details have been logged to the console.</pre>
          <button type="button" onClick={() => window.location.reload()}>
            Reload window
          </button>
          <button type="button" onClick={() => this.setState({ error: null })} style={{ marginLeft: 8 }}>
            Dismiss
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
