import { canonicalJson, sha256Hex } from "../../prompt-core/canonical-json"
import type { PromptCacheContext } from "./prompt-preparation-service"

const signature = (value: unknown): string => sha256Hex(canonicalJson(value))

export function promptCacheContext(input: {
  locale: string
  workspaceRoot: string | null
  contextProjection: unknown
  plugins: unknown
  skills: unknown
  attachments: unknown
  providerId: string
  modelId: string
}): PromptCacheContext {
  return Object.freeze({
    locale: input.locale,
    contextSignature: signature({ workspaceRoot: input.workspaceRoot, contextProjection: input.contextProjection }),
    pluginSignature: signature(input.plugins),
    skillSignature: signature(input.skills),
    attachmentSignature: signature(input.attachments),
    providerId: input.providerId,
    modelId: input.modelId
  })
}

export function hubPromptCacheContext(input: {
  locale?: string
  workspaceRoot?: string | null
  contextSignature?: string
  pluginSignature?: string
  skillSignature?: string
  attachmentSignature?: string
  providerId: string
  modelId: string
}): PromptCacheContext {
  return Object.freeze({
    locale: input.locale || "en-US",
    contextSignature: input.contextSignature || signature({ workspaceRoot: input.workspaceRoot || null }),
    pluginSignature: input.pluginSignature || signature([]),
    skillSignature: input.skillSignature || signature([]),
    attachmentSignature: input.attachmentSignature || signature([]),
    providerId: input.providerId,
    modelId: input.modelId
  })
}
