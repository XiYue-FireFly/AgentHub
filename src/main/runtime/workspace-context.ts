import { resolve } from "node:path"
import { getWorkspaceManager, type Workspace } from "../hub/workspace"
import { buildProjectMap, flattenProjectMap } from "./project-map"

function sameResolvedPath(left: string, right: string): boolean {
  const resolvedLeft = resolve(left)
  const resolvedRight = resolve(right)
  return process.platform === "win32"
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight
}

function formatWorkspaceContext(workspace: Workspace): string {
  const lines = [
    "[AgentHub Workspace Context]",
    "The current request is bound to this local workspace. Use it as project context when answering, especially for API/provider models that cannot inspect the working directory directly.",
    `Name: ${workspace.name}`,
    `Root: ${workspace.rootPath}`
  ]
  const projectMap = buildProjectMap(workspace.rootPath, 2)
  if (projectMap) {
    const entries = flattenProjectMap(projectMap).slice(0, 80)
    if (entries.length) {
      lines.push("", "Top-level project map:", ...entries.map(entry => `- ${entry}`))
    }
  }
  return lines.join("\n")
}

export function workspaceContextPrompt(workspaceId: string | null | undefined): string {
  if (!workspaceId) return ""
  const workspace = getWorkspaceManager().getById(workspaceId)
  return workspace
    ? formatWorkspaceContext(workspace)
    : `[AgentHub Workspace Context]\nWorkspace not found: ${workspaceId}`
}

export function workspaceContextPromptForRoot(workspaceRoot: string | null | undefined): string {
  if (!workspaceRoot) return ""
  const workspace = getWorkspaceManager().list().find(item => sameResolvedPath(item.rootPath, workspaceRoot))
  return workspace ? formatWorkspaceContext(workspace) : ""
}
