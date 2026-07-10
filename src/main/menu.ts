import { Menu, MenuItemConstructorOptions, shell } from "electron"

export function installAppMenu(options: {
  sendToActiveWindow: (action: string, params?: Record<string, string>) => void
  openWorkbench: () => void
}): void {
  const send = (action: string, params: Record<string, string> = {}) => {
    options.sendToActiveWindow(action, params)
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        { label: "New window", accelerator: "CmdOrCtrl+Shift+N", click: () => options.openWorkbench() },
        { label: "New chat", accelerator: "CmdOrCtrl+N", click: () => send("new-thread") },
        { label: "Add working folder", click: () => send("open-project") },
        { type: "separator" },
        { label: "Open Git", click: () => send("open-panel", { panel: "git" }) },
        { label: "Open browser", click: () => send("open-panel", { panel: "browser" }) }
      ]
    },
    {
      label: "View",
      submenu: [
        { label: "Chat", accelerator: "CmdOrCtrl+1", click: () => send("view", { view: "chat" }) },
        { label: "Write", accelerator: "CmdOrCtrl+2", click: () => send("view", { view: "write" }) },
        { label: "Tasks", accelerator: "CmdOrCtrl+3", click: () => send("view", { view: "tasks" }) },
        { label: "Requirements", accelerator: "CmdOrCtrl+4", click: () => send("view", { view: "requirements" }) },
        { label: "Settings", accelerator: "CmdOrCtrl+5", click: () => send("view", { view: "settings" }) },
        { type: "separator" },
        { label: "Runs panel", click: () => send("open-panel", { panel: "runs" }) },
        { label: "Worktrees panel", click: () => send("open-panel", { panel: "worktrees" }) },
        { label: "MCP settings", click: () => send("setup", { tab: "mcp" }) }
      ]
    },
    {
      label: "Help",
      submenu: [
        { label: "Open homepage", click: () => void shell.openExternal("https://agenthub.dev") },
        { label: "Open releases", click: () => void shell.openExternal("https://github.com/XiYue-FireFly/AgentHub/releases") }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
