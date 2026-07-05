export async function fileToAttachment(file: File): Promise<WorkbenchAttachment> {
  const path = (file as any).path as string | undefined
  const kind: WorkbenchAttachment['kind'] = file.type.startsWith('image/') ? 'image' : isTextLike(file) ? 'text' : 'file'
  const att: WorkbenchAttachment = {
    id: `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    name: file.name || (kind === 'image' ? 'pasted-image.png' : 'attachment'),
    path,
    mime: file.type || undefined,
    size: file.size,
    createdAt: Date.now()
  }
  if (kind === 'image' && file.size <= 2 * 1024 * 1024) {
    att.dataUrl = await readAsDataUrl(file)
  } else if (kind === 'text' && file.size <= 96 * 1024) {
    att.text = await file.text()
  }
  return att
}

export function pickedFilePathsToAttachments(picked: unknown): WorkbenchAttachment[] {
  if (!Array.isArray(picked)) return []
  const createdAt = Date.now()
  return picked
    .filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
    .map((path, index) => pathToFileAttachment(path, createdAt, index))
}

function pathToFileAttachment(path: string, createdAt: number, index: number): WorkbenchAttachment {
  const name = fileNameFromPath(path)
  return {
    id: `file-${createdAt.toString(36)}-${index}-${attachmentIdSegment(name)}`,
    kind: 'file',
    name,
    path,
    createdAt
  }
}

function fileNameFromPath(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '')
  return normalized.split(/[\\/]/).pop() || path
}

function attachmentIdSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'attachment'
}

function isTextLike(file: File): boolean {
  if (file.type.startsWith('text/') || /json|xml|yaml|javascript|typescript/.test(file.type)) return true
  return /\.(txt|md|markdown|json|jsonc|yaml|yml|toml|ini|env|js|jsx|ts|tsx|css|html|py|go|rs|java|cs|cpp|c|h|sql|sh|ps1)$/i.test(file.name)
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}
