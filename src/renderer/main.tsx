import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './globals.css'

class RootErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[RendererBoundary]', error, info.componentStack)
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="ah-renderer-crash">
        <div>
          <h1>界面加载失败</h1>
          <p>AgentHub 捕获到渲染异常。可以先重新加载窗口，错误详情已经写入开发日志。</p>
          <pre>{this.state.error.message}</pre>
          <button onClick={() => window.location.reload()}>重新加载</button>
        </div>
      </div>
    )
  }
}

window.addEventListener('error', event => {
  console.error('[RendererError]', event.error || event.message)
})

window.addEventListener('unhandledrejection', event => {
  console.error('[RendererUnhandledRejection]', event.reason)
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
)
