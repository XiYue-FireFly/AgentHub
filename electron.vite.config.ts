import { resolve, join } from 'path'
import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * 设计资产同步：把 design_handoff_glass_ui 的官方 Agent 图标（320×320 PNG）
 * 复制到 renderer 静态资源目录。设计包不存在时静默跳过（CI / 其他机器）。
 */
function syncDesignIcons(): void {
  try {
    const srcDir = resolve('AgentHub UI设计/design_handoff_glass_ui/app/icons')
    const dstDir = resolve('src/renderer/public/icons')
    if (!existsSync(srcDir)) return
    mkdirSync(dstDir, { recursive: true })
    for (const f of ['codex.png', 'claude.png', 'hermes.png', 'openclaw.png']) {
      const src = resolve(srcDir, f)
      if (existsSync(src)) copyFileSync(src, resolve(dstDir, f))
    }
  } catch (e) {
    console.warn('[design-icons] sync skipped:', e)
  }
}
syncDesignIcons()

/** Marvis 官方图标：从本机腾讯 Marvis 安装目录提取（文件名带内容哈希，按版本扫描；未安装则跳过） */
function syncMarvisIcon(): void {
  try {
    const dstDir = resolve('src/renderer/public/icons')
    const dst = resolve(dstDir, 'marvis.png')
    if (existsSync(dst)) return
    // LOW-43: Allow overriding Marvis app directory via env var
    const appDir = process.env.MARVIS_APP_DIR || 'D:/Program Files/Tencent/Marvis/Application'
    if (!existsSync(appDir)) return
    mkdirSync(dstDir, { recursive: true })
    for (const v of readdirSync(appDir).sort().reverse()) {
      const assets = join(appDir, v, 'marvis-offline-page', 'assets')
      if (!existsSync(assets)) continue
      const hit = readdirSync(assets).find(f => /^icon-logo-static-.*\.png$/i.test(f))
      if (hit) {
        copyFileSync(join(assets, hit), dst)
        return
      }
    }
  } catch (e) {
    console.warn('[design-icons] marvis icon sync skipped:', e)
  }
}
syncMarvisIcon()

/** MiniMax Code 官方图标：从本机安装目录提取（未安装则跳过） */
function syncMinimaxCodeIcon(): void {
  try {
    const dstDir = resolve('src/renderer/public/icons')
    const dst = resolve(dstDir, 'minimax-code.png')
    if (existsSync(dst)) return
    // LOW-43: Allow overriding MiniMax Code icon path via env var
    const candidates = [
      process.env.MINIMAX_CODE_ICON || '',
      'D:/minimax/MiniMax Code/resources/resources/daemon/browser-plugin/extension/icons/icon128.png',
      join(process.env.LOCALAPPDATA || '', 'Programs', 'MiniMax Code', 'resources', 'resources', 'daemon', 'browser-plugin', 'extension', 'icons', 'icon128.png')
    ]
    for (const src of candidates) {
      if (src && existsSync(src)) {
        mkdirSync(dstDir, { recursive: true })
        copyFileSync(src, dst)
        return
      }
    }
  } catch (e) {
    console.warn('[design-icons] minimax-code icon sync skipped:', e)
  }
}
syncMinimaxCodeIcon()

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer')
      }
    },
    plugins: [
      // 仅开发(serve)生效：放行 Vite/React Fast Refresh 注入的 inline 预置脚本，
      // 否则 index.html 的 CSP（script-src 'self'）会拦截它，导致 React 不挂载、渲染黑屏。
      // 生产构建（loadFile）不注入该脚本，CSP 保持严格，安全性不受影响。
      {
        name: 'dev-csp-relax',
        apply: 'serve',
        transformIndexHtml: (html: string) =>
          // LOW-42: Use regex with negative lookahead to avoid double-replacing
          html.replace(
            /script-src\s+'self'(?!\s+'unsafe-inline')/,
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
          )
      },
      react(),
      // MED-33: Re-add @tailwindcss/vite plugin for Tailwind CSS v4 processing
      tailwindcss()
    ]
  }
})
