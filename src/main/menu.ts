import { BrowserWindow, Menu, MenuItemConstructorOptions, shell } from "electron"

export function installAppMenu(mainWindow: BrowserWindow | null): void {
  const send = (action: string, params: Record<string, string> = {}) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send("app:menu-command", { action, params })
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: "文件",
      submenu: [
        { label: "新建对话", accelerator: "CmdOrCtrl+N", click: () => send("new-thread") },
        { label: "添加工作目录", click: () => send("open-project") },
        { type: "separator" },
        { label: "打开 Git", click: () => send("open-panel", { panel: "git" }) },
        { label: "打开浏览器", click: () => send("open-panel", { panel: "browser" }) }
      ]
    },
    {
      label: "视图",
      submenu: [
        { label: "对话", accelerator: "CmdOrCtrl+1", click: () => send("view", { view: "chat" }) },
        { label: "写作", accelerator: "CmdOrCtrl+2", click: () => send("view", { view: "write" }) },
        { label: "任务历史", accelerator: "CmdOrCtrl+3", click: () => send("view", { view: "tasks" }) },
        { label: "设置", accelerator: "CmdOrCtrl+4", click: () => send("view", { view: "settings" }) },
        { type: "separator" },
        { label: "运行面板", click: () => send("open-panel", { panel: "runs" }) },
        { label: "工作树", click: () => send("open-panel", { panel: "worktrees" }) },
        { label: "长期记忆", click: () => send("open-panel", { panel: "memory" }) },
        { label: "版本与更新", click: () => send("setup", { tab: "updates" }) },
        { label: "MCP 配置", click: () => send("setup", { tab: "mcp" }) },
        { label: "使用统计", click: () => send("setup", { tab: "usage" }) }
      ]
    },
    {
      label: "帮助",
      submenu: [
        { label: "打开项目主页", click: () => void shell.openExternal("https://agenthub.dev") },
        { label: "打开下载页", click: () => void shell.openExternal("https://github.com/XiYue-FireFly/AgengHub/releases") },
        { type: "separator" },
        { label: "检查更新", click: () => send("setup", { tab: "updates" }) }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
