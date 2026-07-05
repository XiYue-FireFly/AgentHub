import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Icon, IC } from '../../../glass/ui'
import { tr } from '../../../glass/i18n'
import { normalizeUrl, browserCaptureToAttachment, browserCaptureToSnapshot } from '../../utils/browserUtils'
import { PanelTitle } from '../PanelTitle'

interface BrowserPanelProps {
  workspaceId: string | null
  onClose: () => void
  initialUrl?: string | null
  onInitialUrlConsumed?: () => void
  onAttach: (attachment: WorkbenchAttachment) => void
}

export function BrowserPanel({
  workspaceId,
  onClose,
  initialUrl,
  onInitialUrlConsumed,
  onAttach
}: BrowserPanelProps) {
  const [url, setUrl] = useState('')
  const [session, setSession] = useState<BrowserSession | null>(null)
  const [captured, setCaptured] = useState<BrowserContextAttachment | null>(null)
  const [attached, setAttached] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [navState, setNavState] = useState({ canGoBack: false, canGoForward: false })
  const webviewRef = useRef<any>(null)

  const open = useCallback(async (nextUrl = url) => {
    if (!nextUrl.trim()) return
    setLoadError(null)
    const next = await window.electronAPI.browser.open({ workspaceId, url: normalizeUrl(nextUrl) })
    setSession(next)
    setUrl(next.url)
  }, [url, workspaceId])

  useEffect(() => {
    if (!initialUrl) return
    setUrl(initialUrl)
    open(initialUrl).catch(e => setLoadError(e?.message || tr('打开网页失败。', 'Failed to open page.')))
    onInitialUrlConsumed?.()
  }, [initialUrl, onInitialUrlConsumed, open])

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview || !session) return
    const syncNav = () => {
      try {
        setNavState({
          canGoBack: !!webview.canGoBack?.(),
          canGoForward: !!webview.canGoForward?.()
        })
      } catch { /* webview API 调用可能失败，忽略 */ }
    }
    const start = () => { setLoading(true); setLoadError(null); syncNav() }
    const stop = () => {
      setLoading(false)
      syncNav()
      try {
        const currentUrl = webview.getURL?.()
        if (currentUrl) setUrl(currentUrl)
      } catch { /* webview API 调用可能失败，忽略 */ }
    }
    const fail = (event: any) => {
      setLoading(false)
      const reason = event?.errorDescription || event?.errorCode || tr('页面加载失败。', 'Page failed to load.')
      setLoadError(String(reason))
      syncNav()
    }
    const title = (event: any) => {
      const nextTitle = event?.title || ''
      if (nextTitle) setSession(current => current ? { ...current, title: nextTitle } : current)
    }
    webview.addEventListener?.('did-start-loading', start)
    webview.addEventListener?.('did-stop-loading', stop)
    webview.addEventListener?.('did-navigate', stop)
    webview.addEventListener?.('did-navigate-in-page', stop)
    webview.addEventListener?.('did-fail-load', fail)
    webview.addEventListener?.('page-title-updated', title)
    return () => {
      webview.removeEventListener?.('did-start-loading', start)
      webview.removeEventListener?.('did-stop-loading', stop)
      webview.removeEventListener?.('did-navigate', stop)
      webview.removeEventListener?.('did-navigate-in-page', stop)
      webview.removeEventListener?.('did-fail-load', fail)
      webview.removeEventListener?.('page-title-updated', title)
    }
  }, [session?.id])

  const capture = async () => {
    const webview = webviewRef.current
    if (!webview) return
    const result = await webview.executeJavaScript(`(() => {
      const text = document.body ? document.body.innerText.slice(0, 12000) : ''
      const headings = Array.from(document.querySelectorAll('h1,h2,h3')).slice(0, 24).map(el => el.textContent?.trim()).filter(Boolean)
      const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 40).map(a => ({ text: a.textContent?.trim().slice(0, 80) || a.href, href: a.href }))
      const forms = Array.from(document.querySelectorAll('form')).slice(0, 10).map(form => form.getAttribute('aria-label') || form.getAttribute('name') || 'form')
      return { url: location.href, title: document.title, text, headings, links, forms, capturedAt: Date.now() }
    })()`)
    const attachment = await window.electronAPI.browser.capture(result)
    setCaptured(attachment)
    onAttach(browserCaptureToAttachment(attachment))
    setAttached(true)
  }

  return (
    <div className="wb-tool-panel wb-browser-panel">
      <PanelTitle title={tr('页面捕获', 'Page Capture')} subtitle={session?.title || session?.url || tr('输入网址载入页面', 'Enter a URL to load')} onClose={onClose} />
      <div className="wb-browser-toolbar">
        <button onClick={() => webviewRef.current?.goBack?.()} disabled={!session || !navState.canGoBack}><Icon d={IC.chev} size={13} style={{ transform: 'rotate(180deg)' }} /></button>
        <button onClick={() => webviewRef.current?.goForward?.()} disabled={!session || !navState.canGoForward}><Icon d={IC.chev} size={13} /></button>
        <button onClick={() => webviewRef.current?.reload?.()} disabled={!session}><Icon d={IC.refresh} size={13} /></button>
        <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') open().catch(err => setLoadError(err?.message || tr('打开网页失败。', 'Failed to open page.'))) }} placeholder={tr('输入网址', 'Enter URL')} />
        <button onClick={() => open().catch(err => setLoadError(err?.message || tr('打开网页失败。', 'Failed to open page.')))} disabled={!url.trim()}>{loading ? tr('载入中', 'Loading') : tr('打开', 'Open')}</button>
        <button onClick={capture} disabled={!session || loading}>{tr('捕获', 'Capture')}</button>
        {captured && (
          <>
            <button onClick={async () => {
              if (!captured) return
              // Get structured text snapshot, then ask the LLM to summarize it.
              const snapshotText = await window.electronAPI.browser.summarize(browserCaptureToSnapshot(captured))
              const res = await window.electronAPI.ai.quickComplete({
                prompt: snapshotText,
                systemPrompt: 'Summarize the following web page snapshot concisely: key topic, main points, and notable links. Reply in the user\'s language.'
              })
              const summary = res.content || snapshotText
              // Add summary to composer or show in panel
              const attachment: WorkbenchAttachment = {
                id: `browser-summary-${Date.now()}`,
                kind: 'text',
                name: `Summary: ${captured.title || captured.url}`,
                text: res.error ? `${snapshotText}\n\n[AI summary failed: ${res.error}]` : summary,
                createdAt: Date.now()
              }
              onAttach(attachment)
              setAttached(true)
            }} disabled={!captured}>{tr('AI 总结', 'AI Summary')}</button>
            <button onClick={async () => {
              if (!captured) return
              const prompt = await window.electronAPI.browser.analyzePrompt(browserCaptureToSnapshot(captured), tr('分析这个页面的主要内容和结构', 'Analyze the main content and structure of this page'))
              // Run the analysis prompt through the LLM instead of just attaching the prompt text.
              const res = await window.electronAPI.ai.quickComplete({
                prompt,
                systemPrompt: 'You analyze web pages. Provide a structured analysis: purpose, key sections, content type, and any notable patterns. Reply in the user\'s language.'
              })
              const analysis = res.content || prompt
              // Add analysis to composer
              const attachment: WorkbenchAttachment = {
                id: `browser-analysis-${Date.now()}`,
                kind: 'text',
                name: `Analysis: ${captured.title || captured.url}`,
                text: res.error ? `${prompt}\n\n[AI analysis failed: ${res.error}]` : analysis,
                createdAt: Date.now()
              }
              onAttach(attachment)
              setAttached(true)
            }} disabled={!captured}>{tr('AI 分析', 'AI Analyze')}</button>
          </>
        )}
        <button onClick={() => session?.url && window.electronAPI.app.openExternal(session.url)} disabled={!session}><Icon d={IC.link} size={13} /></button>
      </div>
      {loadError && <div className="wb-send-error">{loadError}</div>}
      {captured && <div className="wb-muted-box">{attached ? tr('已加入下一轮上下文：', 'Attached to next prompt: ') : tr('已捕获页面上下文：', 'Captured page context: ')}{captured.title || captured.url}</div>}
      {session
        ? <webview ref={webviewRef} className="wb-browser-webview" src={session.url} allowpopups={false} />
        : <div className="wb-browser-blank"><Icon d={IC.search} size={20} /><strong>{tr('浏览器未打开', 'Browser is blank')}</strong><span>{tr('输入网址后再载入页面。', 'Enter a URL to load a page.')}</span></div>}
    </div>
  )
}
