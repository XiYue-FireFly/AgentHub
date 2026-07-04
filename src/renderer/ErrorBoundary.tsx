import React, { Component, type ReactNode } from 'react'
import { tr } from './glass/i18n'

interface Props {
  children: ReactNode
  /** Optional label for identifying which section crashed. */
  label?: string
  /** Optional fallback UI. */
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

  private handleRetry = () => {
    this.setState(prev => ({ hasError: false, error: null, errorInfo: null, resetKey: prev.resetKey + 1 }))
  }

  private handleReloadApp = () => {
    window.location.reload()
  }

  private handleCopyError = () => {
    const text = `[${this.props.label || 'Error'}]\n${this.state.error?.message}\n${this.state.error?.stack}\n${this.state.errorInfo}`
    navigator.clipboard.writeText(text).catch(() => {})
  }

  private isChunkLoadError(): boolean {
    const error = this.state.error
    const text = `${error?.name || ''}\n${error?.message || ''}\n${error?.stack || ''}`
    return /Failed to fetch dynamically imported module|Loading chunk|ChunkLoadError|Importing a module script failed/i.test(text)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      const chunkLoadError = this.isChunkLoadError()
      return (
        <div className="wb-error-boundary">
          <div className="wb-error-boundary-card">
            <div className="wb-error-boundary-icon">!</div>
            <strong>{this.props.label ? `${this.props.label} - ` : ''}{tr('页面加载失败', 'Something went wrong')}</strong>
            <p className="wb-error-boundary-msg">
              {chunkLoadError
                ? tr('应用资源已更新，请重新加载窗口后再打开该页面。', 'The app assets changed. Reload the window, then open this page again.')
                : (this.state.error?.message || tr('发生了未知错误。', 'An unexpected error occurred.'))}
            </p>
            <div className="wb-error-boundary-actions">
              <button className="ah-btn sm primary" onClick={this.handleReloadApp}>{tr('重新加载应用', 'Reload app')}</button>
              <button className="ah-btn sm" onClick={this.handleRetry}>{tr('重试页面', 'Retry page')}</button>
              <button className="ah-btn sm" onClick={this.handleCopyError}>{tr('复制错误', 'Copy error')}</button>
            </div>
          </div>
        </div>
      )
    }
    return <div key={this.state.resetKey} style={{ display: 'contents' }}>{this.props.children}</div>
  }
}
