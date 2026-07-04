/**
 * SDD Store - 需求存储层
 *
 * 负责需求的 CRUD 操作和追踪快照的持久化
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import * as crypto from 'crypto'
import {
  SddDraft,
  SddDraftMeta,
  SddTrace,
  SddTraceSnapshot,
  SddCreateOptions,
  SddUpdateOptions,
  SDD_REQUIREMENTS_RELATIVE_DIR,
  SDD_DRAFT_FILE_NAME,
  SDD_TRACE_FILE_NAME,
  SDD_CHAT_DIR_NAME,
  SDD_IMG_DIR_NAME
} from './sdd-types'

type DraftMetaFile = {
  title?: string
  designContext?: SddDraft['designContext']
  createdAt?: string
  updatedAt?: string
}

// ============================================================
// 路径工具
// ============================================================

function buildDraftRelativePath(draftId: string): string {
  return `${SDD_REQUIREMENTS_RELATIVE_DIR}/${draftId}/${SDD_DRAFT_FILE_NAME}`
}

function buildDraftDirPath(workspaceRoot: string, draftId: string): string {
  return path.join(workspaceRoot, SDD_REQUIREMENTS_RELATIVE_DIR, draftId)
}

function buildDraftFilePath(workspaceRoot: string, draftId: string): string {
  return path.join(buildDraftDirPath(workspaceRoot, draftId), SDD_DRAFT_FILE_NAME)
}

function buildTraceFilePath(workspaceRoot: string, draftId: string): string {
  return path.join(buildDraftDirPath(workspaceRoot, draftId), SDD_TRACE_FILE_NAME)
}

function buildChatDirPath(workspaceRoot: string, draftId: string): string {
  return path.join(buildDraftDirPath(workspaceRoot, draftId), SDD_CHAT_DIR_NAME)
}

function buildImgDirPath(workspaceRoot: string, draftId: string): string {
  return path.join(buildDraftDirPath(workspaceRoot, draftId), SDD_IMG_DIR_NAME)
}

function buildMetaFilePath(workspaceRoot: string, draftId: string): string {
  return path.join(buildDraftDirPath(workspaceRoot, draftId), 'meta.json')
}

function generateDraftId(): string {
  return crypto.randomUUID()
}

function extractTitleFromContent(content: string): string {
  const lines = content.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('# ')) {
      return trimmed.slice(2).trim()
    }
  }
  return 'Untitled Requirement'
}

function normalizeTitle(value: string | undefined): string {
  const title = (value || '').trim()
  return title || 'Untitled Requirement'
}

function applyTitleToContent(content: string, title: string): string {
  const heading = `# ${normalizeTitle(title)}`
  if (!content.trim()) return `${heading}\n`
  if (/^# .*(?:\r?\n|$)/.test(content)) {
    return content.replace(/^# .*(?:\r?\n|$)/, `${heading}\n`)
  }
  return `${heading}\n\n${content}`
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmpPath, content, 'utf-8')
  await fs.rename(tmpPath, filePath)
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8')) as T
  } catch {
    return null
  }
}

async function readDraftMetaFile(workspaceRoot: string, draftId: string): Promise<DraftMetaFile> {
  return await readJsonFile<DraftMetaFile>(buildMetaFilePath(workspaceRoot, draftId)) ?? {}
}

async function writeDraftMetaFile(workspaceRoot: string, draftId: string, meta: DraftMetaFile): Promise<void> {
  await writeFileAtomic(buildMetaFilePath(workspaceRoot, draftId), JSON.stringify(meta, null, 2))
}

async function readDraftTitleFromFile(filePath: string): Promise<string | null> {
  try {
    const handle = await fs.open(filePath, 'r')
    try {
      const buffer = Buffer.alloc(4096)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      const title = extractTitleFromContent(buffer.subarray(0, bytesRead).toString('utf-8'))
      return title === 'Untitled Requirement' ? null : title
    } finally {
      await handle.close()
    }
  } catch {
    return null
  }
}

// ============================================================
// 默认模板（参照 kun 的 SDD 模板格式）
// ============================================================

const DEFAULT_TEMPLATE_ZH = `# 未命名需求

## 背景

描述此需求的上下文和动机。

## 目标

应该实现什么？

## 验收标准

- [ ] 验收标准 1
- [ ] 验收标准 2
- [ ] 验收标准 3
`

const DEFAULT_TEMPLATE_EN = `# Untitled requirement

## Background

Describe the context and motivation for this requirement.

## Goal

What should be achieved?

## Acceptance criteria

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2
- [ ] Acceptance criterion 3
`

export function getDefaultTemplate(env: NodeJS.ProcessEnv = process.env, locale = Intl.DateTimeFormat().resolvedOptions().locale || ''): string {
  const languageSignals = [env.LANG, env.LANGUAGE, env.LC_ALL, locale].filter((value): value is string => Boolean(value))
  const isChinese = languageSignals.some(value =>
    value.startsWith('zh') || value.includes('CN') || value.includes('TW')
  )
  return isChinese ? DEFAULT_TEMPLATE_ZH : DEFAULT_TEMPLATE_EN
}

// ============================================================
// SDD Store
// ============================================================

export class SddStore {
  private readonly workspaceRoot: string

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot
  }

  /**
   * 创建需求草稿
   */
  async createDraft(options: SddCreateOptions): Promise<SddDraft> {
    const draftId = generateDraftId()
    const now = new Date().toISOString()
    const baseContent = options.template === 'blank' ? '' : getDefaultTemplate()
    const title = normalizeTitle(options.title || extractTitleFromContent(baseContent))
    const content = applyTitleToContent(baseContent, title)

    const draft: SddDraft = {
      id: draftId,
      workspaceRoot: this.workspaceRoot,
      relativePath: buildDraftRelativePath(draftId),
      title,
      content,
      designContext: options.designContext,
      createdAt: now,
      updatedAt: now
    }

    // 创建目录结构
    const dirPath = buildDraftDirPath(this.workspaceRoot, draftId)
    await fs.mkdir(dirPath, { recursive: true })
    await fs.mkdir(path.join(dirPath, SDD_CHAT_DIR_NAME), { recursive: true })
    await fs.mkdir(path.join(dirPath, SDD_IMG_DIR_NAME), { recursive: true })

    // 写入需求文件
    await writeFileAtomic(buildDraftFilePath(this.workspaceRoot, draftId), content)
    await writeDraftMetaFile(this.workspaceRoot, draftId, {
      title,
      designContext: options.designContext,
      createdAt: now,
      updatedAt: now
    })

    return draft
  }

  /**
   * 读取需求草稿（包含 designContext）
   */
  async getDraft(draftId: string): Promise<SddDraft | null> {
    const filePath = buildDraftFilePath(this.workspaceRoot, draftId)

    try {
      const content = await fs.readFile(filePath, 'utf-8')
      const stat = await fs.stat(filePath)
      const meta = await readDraftMetaFile(this.workspaceRoot, draftId)

      // 读取设计上下文（保存在 meta.json 中）
      let designContext: SddDraft['designContext']
      try {
        const metaPath = path.join(buildDraftDirPath(this.workspaceRoot, draftId), 'meta.json')
        const metaContent = await fs.readFile(metaPath, 'utf-8')
        const meta = JSON.parse(metaContent)
        designContext = meta.designContext
      } catch {
        // meta.json 不存在或解析失败时使用 undefined
      }

      return {
        id: draftId,
        workspaceRoot: this.workspaceRoot,
        relativePath: buildDraftRelativePath(draftId),
        title: normalizeTitle(meta.title || extractTitleFromContent(content)),
        content,
        designContext: meta.designContext ?? designContext,
        createdAt: meta.createdAt || stat.birthtime.toISOString(),
        updatedAt: meta.updatedAt || stat.mtime.toISOString()
      }
    } catch {
      return null
    }
  }

  /**
   * 更新需求草稿
   */
  async updateDraft(draftId: string, options: SddUpdateOptions): Promise<void> {
    const filePath = buildDraftFilePath(this.workspaceRoot, draftId)

    try {
      let content = options.content
      if (content === undefined) {
        content = await fs.readFile(filePath, 'utf-8')
      }

      await writeFileAtomic(filePath, content)

      const previousMeta = await readDraftMetaFile(this.workspaceRoot, draftId)
      const now = new Date().toISOString()
      await writeDraftMetaFile(this.workspaceRoot, draftId, {
        ...previousMeta,
        title: extractTitleFromContent(content),
        designContext: options.designContext ?? previousMeta.designContext,
        createdAt: previousMeta.createdAt || now,
        updatedAt: now
      })
    } catch (error) {
      throw new Error(`Failed to update draft ${draftId}: ${error}`)
    }
  }

  /**
   * 删除需求草稿
   */
  async deleteDraft(draftId: string): Promise<void> {
    const dirPath = buildDraftDirPath(this.workspaceRoot, draftId)

    try {
      await fs.rm(dirPath, { recursive: true, force: true })
    } catch (error) {
      throw new Error(`Failed to delete draft ${draftId}: ${error}`)
    }
  }

  /**
   * 列出所有需求
   */
  async listDrafts(): Promise<SddDraftMeta[]> {
    const reqDir = path.join(this.workspaceRoot, SDD_REQUIREMENTS_RELATIVE_DIR)

    try {
      const entries = await fs.readdir(reqDir, { withFileTypes: true })
      const drafts: SddDraftMeta[] = []

      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const draftId = entry.name
        const filePath = buildDraftFilePath(this.workspaceRoot, draftId)
        try {
          const stat = await fs.stat(filePath)
          const meta = await readDraftMetaFile(this.workspaceRoot, draftId)
          const title = normalizeTitle(meta.title || await readDraftTitleFromFile(filePath) || undefined)
          drafts.push({
            id: draftId,
            workspaceRoot: this.workspaceRoot,
            relativePath: buildDraftRelativePath(draftId),
            title,
            createdAt: meta.createdAt || stat.birthtime.toISOString(),
            updatedAt: meta.updatedAt || stat.mtime.toISOString()
          })
        } catch {
          // Ignore incomplete draft directories.
        }
      }

      // 按更新时间降序排列
      drafts.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

      return drafts
    } catch {
      return []
    }
  }

  /**
   * 保存追踪快照
   */
  async saveTrace(draftId: string, trace: SddTrace): Promise<void> {
    const filePath = buildTraceFilePath(this.workspaceRoot, draftId)
    const snapshot: SddTraceSnapshot = {
      version: 1,
      draftId,
      trace,
      savedAt: new Date().toISOString()
    }

    await writeFileAtomic(filePath, JSON.stringify(snapshot, null, 2))
  }

  /**
   * 读取追踪快照
   */
  async getTrace(draftId: string): Promise<SddTrace | null> {
    const filePath = buildTraceFilePath(this.workspaceRoot, draftId)

    try {
      const content = await fs.readFile(filePath, 'utf-8')
      const snapshot: SddTraceSnapshot = JSON.parse(content)
      return snapshot.trace
    } catch {
      return null
    }
  }

  /**
   * 检查需求是否存在
   */
  async exists(draftId: string): Promise<boolean> {
    const filePath = buildDraftFilePath(this.workspaceRoot, draftId)
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }

  /**
   * 获取需求目录路径
   */
  getDraftDirPath(draftId: string): string {
    return buildDraftDirPath(this.workspaceRoot, draftId)
  }

  /**
   * 获取聊天目录路径
   */
  getChatDirPath(draftId: string): string {
    return buildChatDirPath(this.workspaceRoot, draftId)
  }

  /**
   * 获取图片目录路径
   */
  getImgDirPath(draftId: string): string {
    return buildImgDirPath(this.workspaceRoot, draftId)
  }
}

/**
 * 创建 SDD Store 实例
 */
export function createSddStore(workspaceRoot: string): SddStore {
  return new SddStore(workspaceRoot)
}
