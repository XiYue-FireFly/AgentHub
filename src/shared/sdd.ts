/**
 * SDD (Spec Driven Development) Shared Path Utilities
 *
 * 参照 Kun 的 SDD 系统设计，适配 AgentHub 的目录结构
 * One requirement = one self-contained directory:
 * `.agenthub/requirements/<uuid>/{requirement.md, trace.json, img/, chat/}`
 */

export const SDD_RELATIVE_DIR = '.agenthub'
export const SDD_REQUIREMENTS_RELATIVE_DIR = `${SDD_RELATIVE_DIR}/requirements`
export const SDD_DRAFT_FILE_NAME = 'requirement.md'
export const SDD_TRACE_FILE_NAME = 'trace.json'
export const SDD_PLAN_FILE_NAME = 'plan.md'
export const SDD_CHAT_DIR_NAME = 'chat'
export const SDD_CHAT_META_FILE_NAME = 'meta.json'
export const SDD_IMG_DIR_NAME = 'img'
export const SDD_PROTO_DIR_NAME = 'proto'

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function normalizeSddRelativePath(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/\/+/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
}

export function buildSddDraftRelativePath(id: string): string {
  return `${SDD_REQUIREMENTS_RELATIVE_DIR}/${id}/${SDD_DRAFT_FILE_NAME}`
}

export function isSddDraftRelativePath(value: string): boolean {
  const normalized = normalizeSddRelativePath(value)
  const parts = normalized.split('/')
  return (
    parts.length === 4 &&
    parts[0] === SDD_RELATIVE_DIR &&
    parts[1] === 'requirements' &&
    UUID_LIKE.test(parts[2] ?? '') &&
    parts[3] === SDD_DRAFT_FILE_NAME
  )
}

/** Extract the requirement folder (uuid) from a draft-relative path, or null. */
export function sddDraftFolderFromRelativePath(value: string): string | null {
  const normalized = normalizeSddRelativePath(value)
  const parts = normalized.split('/')
  if (parts.length !== 4 || parts[0] !== SDD_RELATIVE_DIR || parts[1] !== 'requirements') return null
  return UUID_LIKE.test(parts[2] ?? '') ? parts[2] : null
}

/** The requirement's self-contained unit directory (`.agenthub/requirements/<uuid>`). */
export function sddRequirementUnitDir(draftRelativePath: string): string | null {
  const folder = sddDraftFolderFromRelativePath(draftRelativePath)
  return folder ? `${SDD_REQUIREMENTS_RELATIVE_DIR}/${folder}` : null
}

/** Images pasted into / generated for this requirement live in `<unit>/img`. */
export function sddUnitImageDir(draftRelativePath: string): string | null {
  const unit = sddRequirementUnitDir(draftRelativePath)
  return unit ? `${unit}/${SDD_IMG_DIR_NAME}` : null
}

/** Interactive prototypes generated for this requirement live in `<unit>/proto`. */
export function sddUnitProtoDir(draftRelativePath: string): string | null {
  const unit = sddRequirementUnitDir(draftRelativePath)
  return unit ? `${unit}/${SDD_PROTO_DIR_NAME}` : null
}

/** AI conversation records for this requirement live in `<unit>/chat`. */
export function sddUnitChatDir(draftRelativePath: string): string | null {
  const unit = sddRequirementUnitDir(draftRelativePath)
  return unit ? `${unit}/${SDD_CHAT_DIR_NAME}` : null
}

/** Sidecar trace file for a draft (`<unit>/trace.json`). */
export function sddDraftTraceRelativePath(draftRelativePath: string): string | null {
  const unit = sddRequirementUnitDir(draftRelativePath)
  return unit ? `${unit}/${SDD_TRACE_FILE_NAME}` : null
}

/** Build the plan relative path for a requirement draft. */
export function buildSddPlanRelativePath(draftId: string): string {
  return `${SDD_RELATIVE_DIR}/plan/sdd-${draftId}.md`
}

/**
 * Map an SDD-generated plan path (`.agenthub/plan/sdd-<uuid>[-n].md`) back to
 * its requirement draft path, or null for non-SDD plans.
 */
export function sddDraftRelativePathForPlanPath(planRelativePath: string): string | null {
  const normalized = normalizeSddRelativePath(planRelativePath)
  const match = new RegExp(
    `^${SDD_RELATIVE_DIR.replace('.', '\\.')}/plan/sdd-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-\\d+)?\\.md$`,
    'i'
  ).exec(normalized)
  if (!match) return null
  return buildSddDraftRelativePath(match[1].toLowerCase())
}

/** Whether a workspace-relative path is inside ANY requirement unit's img subdir. */
export function isSddImageRelativePath(value: string): boolean {
  const normalized = normalizeSddRelativePath(value)
  const parts = normalized.split('/')
  if (parts.length < 5) return false
  if (parts[0] !== SDD_RELATIVE_DIR || parts[1] !== 'requirements') return false
  if (!UUID_LIKE.test(parts[2] ?? '')) return false
  if (parts[3] !== SDD_IMG_DIR_NAME) return false
  return !parts.slice(4).some((part) => !part || part === '.' || part === '..')
}

/** Whether a workspace-relative path is inside ANY requirement unit's proto subdir. */
export function isSddPrototypeRelativePath(value: string): boolean {
  const normalized = normalizeSddRelativePath(value)
  const parts = normalized.split('/')
  if (parts.length < 5) return false
  if (parts[0] !== SDD_RELATIVE_DIR || parts[1] !== 'requirements') return false
  if (!UUID_LIKE.test(parts[2] ?? '')) return false
  if (parts[3] !== SDD_PROTO_DIR_NAME) return false
  return !parts.slice(4).some((part) => !part || part === '.' || part === '..')
}
