import { isAbsolute, relative, resolve, sep } from 'node:path'

export function isPathInsideBase(targetPath: string, basePath: string): boolean {
  if (!targetPath || !basePath) return false
  const base = resolve(basePath)
  const target = resolve(targetPath)
  const rel = relative(base, target)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

export function resolveWorkspaceRelativePath(
  workspaceRoot: string,
  relativePath: string,
  options: { allowRoot?: boolean } = {}
): string | null {
  if (!workspaceRoot || typeof relativePath !== 'string') return null
  const requested = relativePath || '.'
  if (!options.allowRoot && requested === '.') return null
  if (isAbsolute(requested)) return null
  const target = resolve(workspaceRoot, requested)
  return isPathInsideBase(target, workspaceRoot) ? target : null
}

export function resolvePathWithinAllowedBases(
  pathText: string,
  defaultBase: string,
  allowedBases: Array<string | null | undefined>
): string {
  const requested = pathText || ''
  const resolved = isAbsolute(requested) ? resolve(requested) : resolve(defaultBase || '.', requested)
  if (allowedBases.some(base => !!base && isPathInsideBase(resolved, base))) return resolved
  throw new Error('Access denied: path outside allowed directories')
}
