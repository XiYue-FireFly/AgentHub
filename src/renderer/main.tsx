import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './globals.css'

const FALLBACK_STYLE_ID = 'agenthub-workbench-style-fallback'

function installStyleHealthCheck(): void {
  const fallbackCss = `
    *, *::before, *::after { box-sizing: border-box; }
    html, body, #root { height: 100%; margin: 0; overflow: hidden; }
    body {
      font-family: var(--font-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif);
      background: var(--wb-bg, #f7f8fb);
      color: var(--wb-text, #20242c);
    }
    button, input, textarea, select { font: inherit; letter-spacing: 0; }
    .wb-root {
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: var(--wb-bg, #f7f8fb);
      color: var(--wb-text, #20242c);
    }
    .wb-titlebar {
      height: var(--wb-titlebar-height, 32px);
      flex: none;
      display: flex;
      align-items: center;
      gap: 18px;
      padding: 0 12px 0 16px;
      border-bottom: 1px solid var(--wb-line, #dfe5ee);
      background: var(--wb-panel, #fff);
    }
    .wb-shell {
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(var(--wb-sidebar-width, 240px), 320px) minmax(0, 1fr);
      overflow: hidden;
      background: var(--wb-bg, #f7f8fb);
    }
    .wb-sidebar {
      min-width: 0;
      overflow: auto;
      padding: 18px 14px;
      border-right: 1px solid var(--wb-line, #dfe5ee);
      background: var(--wb-sidebar, #eef2f7);
    }
    .wb-main {
      min-width: 0;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: var(--wb-panel, #fff);
    }
    .wb-chat-head {
      flex: none;
      min-height: 70px;
      display: flex;
      align-items: center;
      padding: 16px 28px;
      border-bottom: 1px solid var(--wb-line-soft, #edf0f5);
      background: var(--wb-panel, #fff);
    }
    .wb-thread {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 24px 32px 150px;
    }
    .wb-scroll-surface {
      flex: 1;
      min-height: 0;
      overflow: auto;
      background: var(--wb-panel, #fff);
    }
    .wb-composer-wrap {
      flex: none;
      padding: 10px 28px 18px;
      background: linear-gradient(180deg, transparent 0%, var(--wb-panel, #fff) 34%);
    }
    .wb-composer {
      width: min(940px, 100%);
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px;
      border: 1px solid var(--wb-line, #dfe5ee);
      border-radius: var(--radius-lg, 20px);
      background: var(--wb-panel, #fff);
      box-shadow: var(--wb-shadow, 0 1px 4px rgba(0, 0, 0, 0.1));
    }
    .wb-composer-input-layer {
      display: flex;
      gap: 10px;
      align-items: flex-end;
    }
    .wb-composer textarea {
      flex: 1;
      min-height: 58px;
      max-height: 180px;
      resize: vertical;
      border: 0;
      outline: none;
      background: transparent;
      color: var(--wb-text, #20242c);
    }
    .wb-turn-attachments,
    .wb-attachment-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .wb-turn-attachment,
    .wb-attachment-chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      max-width: 220px;
      overflow: hidden;
    }
    .wb-turn-attachment img,
    .wb-attachment-chip img,
    .wb-composer img {
      width: 32px;
      height: 32px;
      max-width: 32px;
      max-height: 32px;
      object-fit: cover;
      border-radius: var(--radius-sm, 10px);
      display: block;
    }
    .wb-composer button,
    .wb-composer select,
    .wb-titlebar button,
    .wb-sidebar button {
      border: 1px solid var(--wb-line, #dfe5ee);
      border-radius: var(--radius-sm, 10px);
      background: var(--wb-panel, #fff);
      color: var(--wb-text, #20242c);
    }
    .wb-agent-picker,
    .wb-menu-dropdown,
    .wb-workspace-popover,
    .wb-git-branch-popover {
      position: absolute;
      z-index: 100;
      border: 1px solid var(--wb-line, #dfe5ee);
      border-radius: var(--radius-md, 14px);
      background: var(--wb-panel, #fff);
      box-shadow: var(--wb-shadow-lg, 0 4px 16px rgba(0, 0, 0, 0.15));
    }
  `

  const check = () => {
    const root = document.querySelector<HTMLElement>('.wb-root')
    if (!root) return
    const style = window.getComputedStyle(root)
    const styled = style.display === 'flex' && style.overflow === 'hidden'
    const fallback = document.getElementById(FALLBACK_STYLE_ID)
    // LOW-17: Remove fallback styles once the main stylesheet has properly applied
    if (styled) {
      if (fallback) fallback.remove()
      return
    }
    if (fallback) return
    console.warn('[AgentHub] Workbench stylesheet did not apply; installing fallback layout styles.')
    const tag = document.createElement('style')
    tag.id = FALLBACK_STYLE_ID
    tag.textContent = fallbackCss
    document.head.appendChild(tag)
  }

  let checks = 0
  const timer = window.setInterval(() => {
    checks += 1
    check()
    if (checks >= 10 || document.getElementById(FALLBACK_STYLE_ID)) {
      window.clearInterval(timer)
    }
  }, 500)
}

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
          <p>AgentHub 捕获到渲染异常。可以先重新加载窗口，错误详情已写入开发日志。</p>
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

installStyleHealthCheck()
