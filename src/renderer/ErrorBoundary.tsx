/**
 * ErrorBoundary: catches React render errors and shows a recovery UI.
 *
 * Wraps each major screen. On error, shows a non-blocking toast with
 * "Something went wrong" and a "Reload" button. Logs to console for
 * debugging. Does not crash the entire app.
 */

import React, { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Optional label for identifying which section crashed */
  label?: string
  /** Optional fallback UI */
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: string | null
  resetKey: number
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null, resetKey: 0 }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const label = this.props.label || 'Unknown'
    console.error(`[ErrorBoundary:${label}]`, error, errorInfo.componentStack)
    this.setState({ errorInfo: errorInfo.componentStack || null })
  }

  private handleReload = () => {
    this.setState(prev => ({ hasError: false, error: null, errorInfo: null, resetKey: prev.resetKey + 1 }))
  }

  // LOW-20: Provide navigation to a safe state (full reload resets all state)
  private handleGoHome = () => {
    window.location.reload()
  }

  private handleCopyError = () => {
    const text = `[${this.props.label || 'Error'}]\n${this.state.error?.message}\n${this.state.error?.stack}\n${this.state.errorInfo}`
    navigator.clipboard.writeText(text).catch(() => {})
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="wb-error-boundary">
          <div className="wb-error-boundary-card">
            <div className="wb-error-boundary-icon">⚠</div>
            <strong>{this.props.label ? `${this.props.label} — ` : ''}Something went wrong</strong>
            <p className="wb-error-boundary-msg">{this.state.error?.message || 'An unexpected error occurred.'}</p>
            <div className="wb-error-boundary-actions">
              <button className="ah-btn sm primary" onClick={this.handleReload}>Try again</button>
              <button className="ah-btn sm" onClick={this.handleGoHome}>Go to overview</button>
              <button className="ah-btn sm" onClick={this.handleCopyError}>Copy error</button>
            </div>
          </div>
        </div>
      )
    }
    return <div key={this.state.resetKey} style={{ display: 'contents' }}>{this.props.children}</div>
  }
}
