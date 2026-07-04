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
    const content = options.template === 'blank' ? '' : getDefaultTemplate()
    const title = options.title || extractTitleFromContent(content)

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
    await fs.writeFile(buildDraftFilePath(this.workspaceRoot, draftId), content, 'utf-8')

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
        title: extractTitleFromContent(content),
        content,
        designContext,
        createdAt: stat.birthtime.toISOString(),
        updatedAt: stat.mtime.toISOString()
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

      await fs.writeFile(filePath, content, 'utf-8')

      // 保存设计上下文
      if (options.designContext) {
        const metaPath = path.join(buildDraftDirPath(this.workspaceRoot, draftId), 'meta.json')
        await fs.writeFile(metaPath, JSON.stringify({
          designContext: options.designContext,
          updatedAt: new Date().toISOString()
        }, null, 2), 'utf-8')
      }
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
        const draft = await this.getDraft(draftId)
        if (draft) {
          drafts.push({
            id: draft.id,
            workspaceRoot: draft.workspaceRoot,
            relativePath: draft.relativePath,
            title: draft.title,
            createdAt: draft.createdAt,
            updatedAt: draft.updatedAt
          })
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

    await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf-8')
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
