import type { RuntimeEvent } from "./types"
import { getEnabledContributions } from "./plugin-manager-enhanced"
import { getPluginContributions, scanPlugins } from "./plugin-manager"
import type { ResolvedHook } from "../hooks/hook-engine"

export interface PluginContributionRuntimeOptions {
  workspaceRoot?: string | null
  includeApproval?: boolean
}

type ActivityParser = {
  pluginId?: string
  id: string
  pattern: string
  flags?: string
  kind?: string
  fields?: Record<string, string>
}

type PreDispatchHook = {
  pluginId?: string
  id: string
  pattern?: string
  appendContext?: string
  denyMessage?: string
  requireApproval?: boolean
  message?: string
}

export function getRuntimePluginContributions(options: PluginContributionRuntimeOptions = {}): {
  activityParsers: ActivityParser[]
  preDispatchHooks: PreDispatchHook[]
} {
  const installed = getEnabledContributions()
  const local = options.workspaceRoot ? getPluginContributions(scanPlugins(options.workspaceRoot)) : null
  return {
    activityParsers: [
      ...withPluginFallback(installed.activityParsers || [], "installed"),
      ...(local?.activityParsers || [])
    ],
    preDispatchHooks: [
      ...withPluginFallback(installed.preDispatchHooks || [], "installed"),
      ...(local?.preDispatchHooks || [])
    ]
  }
}

export function applyPluginActivityParsers(
  event: RuntimeEvent,
  options: PluginContributionRuntimeOptions = {}
): RuntimeEvent {
  if (event.kind !== "agent:activity" && event.kind !== "agent:delta" && event.kind !== "agent:error") return event
  const text = activityText(event.payload)
  if (!text) return event
  const matches = []
  for (const parser of getRuntimePluginContributions(options).activityParsers) {
    const parsed = parseActivity(parser, text)
    if (parsed) matches.push(parsed)
  }
  if (matches.length === 0) return event
  return {
    ...event,
    payload: {
      ...(event.payload && typeof event.payload === "object" ? event.payload : { value: event.payload }),
      pluginActivity: matches
    }
  }
}

export function resolvePluginPreDispatchHooks(options: PluginContributionRuntimeOptions = {}): ResolvedHook[] {
  return getRuntimePluginContributions(options).preDispatchHooks.map((hook): ResolvedHook => ({
    phase: "PreDispatch",
    run: (invocation) => {
      if (invocation.phase !== "PreDispatch") return
      if (hook.pattern?.trim() && !new RegExp(hook.pattern, "i").test(invocation.prompt)) return
      if (hook.denyMessage?.trim()) return { decision: "deny", message: hook.denyMessage.trim() }
      if (hook.requireApproval) {
        if (options.includeApproval === false) return
        return {
          decision: 'request-approval',
          requestApproval: {
            pluginId: hook.pluginId || 'plugin',
            hookId: hook.id,
            message: hook.message?.trim() || `Plugin ${hook.pluginId || "plugin"} requires approval before dispatch.`
          }
        }
      }
      if (hook.appendContext?.trim()) return { additionalContext: renderHookTemplate(hook.appendContext, invocation.prompt) }
      if (hook.message?.trim()) return { additionalContext: hook.message.trim() }
      return
    }
  }))
}

function withPluginFallback<T extends object>(items: T[], pluginId: string): Array<T & { pluginId: string }> {
  return items.map(item => ({ ...item, pluginId: typeof (item as any).pluginId === "string" ? (item as any).pluginId : pluginId }))
}

function activityText(payload: unknown): string {
  if (typeof payload === "string") return payload
  if (!payload || typeof payload !== "object") return ""
  const record = payload as Record<string, unknown>
  return String(record.text || record.content || record.delta || record.error || "")
}

function parseActivity(parser: ActivityParser, text: string): Record<string, unknown> | null {
  let regex: RegExp
  try {
    regex = new RegExp(parser.pattern, parser.flags || undefined)
  } catch {
    return null
  }
  const match = regex.exec(text)
  if (!match) return null
  const fields: Record<string, string> = {}
  for (const [key, source] of Object.entries(parser.fields || {})) {
    const index = Number(source)
    if (Number.isInteger(index)) fields[key] = match[index] || ""
    else fields[key] = match.groups?.[source] || ""
  }
  return {
    pluginId: parser.pluginId,
    parserId: parser.id,
    kind: parser.kind || "activity",
    text: match[0],
    fields
  }
}

function renderHookTemplate(template: string, prompt: string): string {
  return template.replaceAll("{{prompt}}", prompt)
}
