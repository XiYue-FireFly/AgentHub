import { BrowserWindow, Menu, MenuItemConstructorOptions, shell } from "electron"

export function installAppMenu(mainWindow: BrowserWindow | null): void {
  const send = (action: string, params: Record<string, string> = {}) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send("app:menu-command", { action, params })
  }

  const isZh = (process.env.LANG || process.env.LC_ALL || '').startsWith('zh')

  const template: MenuItemConstructorOptions[] = [
    {
      label: isZh ? "文件" : "File",
      submenu: [
        { label: isZh ? "新建对话" : "New chat", accelerator: "CmdOrCtrl+N", click: () => send("new-thread") },
        { label: isZh ? "添加工作目录" : "Add working folder", click: () => send("open-project") },
        { type: "separator" },
        { label: isZh ? "打开 Git" : "Open Git", click: () => send("open-panel", { panel: "git" }) },
        { label: isZh ? "打开浏览器" : "Open browser", click: () => send("open-panel", { panel: "browser" }) }
      ]
    },
    {
      label: isZh ? "视图" : "View",
      submenu: [
        { label: isZh ? "对话" : "Chat", accelerator: "CmdOrCtrl+1", click: () => send("view", { view: "chat" }) },
        { label: isZh ? "写作" : "Write", accelerator: "CmdOrCtrl+2", click: () => send("view", { view: "write" }) },
        { label: isZh ? "任务" : "Tasks", accelerator: "CmdOrCtrl+3", click: () => send("view", { view: "tasks" }) },
        { label: isZh ? "需求" : "Requirements", accelerator: "CmdOrCtrl+4", click: () => send("view", { view: "requirements" }) },
        { label: isZh ? "设置" : "Settings", accelerator: "CmdOrCtrl+5", click: () => send("view", { view: "settings" }) },
        { type: "separator" },
        { label: isZh ? "运行面板" : "Runs panel", click: () => send("open-panel", { panel: "runs" }) },
        { label: isZh ? "工作树面板" : "Worktrees panel", click: () => send("open-panel", { panel: "worktrees" }) },
        { label: isZh ? "MCP 设置" : "MCP settings", click: () => send("setup", { tab: "mcp" }) }
      ]
    },
    {
      label: isZh ? "帮助" : "Help",
      submenu: [
        { label: isZh ? "打开主页" : "Open homepage", click: () => void shell.openExternal("https://agenthub.dev") },
        { label: isZh ? "打开发布页" : "Open releases", click: () => void shell.openExternal("https://github.com/XiYue-FireFly/AgengHub/releases") }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
