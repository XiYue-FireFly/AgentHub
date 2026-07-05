import { describe, it, expect } from 'vitest'
import {
  parseRequirementBlocks,
  parsePlanCovers,
  computeCoverage,
  deriveStatuses,
  computeTrace,
  computeCompletionRate
} from '../sdd-trace'

describe('SDD Trace', () => {
  describe('parseRequirementBlocks', () => {
    it('should parse basic R-Block', () => {
      const markdown = `
### R-1: 用户登录 {draft}
实现用户登录功能
- [ ] 支持邮箱登录
- [ ] 支持密码验证
`
      const blocks = parseRequirementBlocks(markdown)
      expect(blocks).toHaveLength(1)
      expect(blocks[0].id).toBe('R-1')
      expect(blocks[0].title).toBe('用户登录')
      expect(blocks[0].status).toBe('draft')
      expect(blocks[0].acceptanceCriteria).toHaveLength(2)
      expect(blocks[0].acceptanceCriteria[0].checked).toBe(false)
    })

    it('should parse multiple R-Blocks', () => {
      const markdown = `
### R-1: 登录功能 {draft}
描述1
- [ ] 标准1

### R-2: 注册功能 {building}
描述2
- [x] 标准2
`
      const blocks = parseRequirementBlocks(markdown)
      expect(blocks).toHaveLength(2)
      expect(blocks[0].id).toBe('R-1')
      expect(blocks[0].status).toBe('draft')
      expect(blocks[1].id).toBe('R-2')
      expect(blocks[1].status).toBe('building')
      expect(blocks[1].acceptanceCriteria[0].checked).toBe(true)
    })

    it('should handle empty markdown', () => {
      const blocks = parseRequirementBlocks('')
      expect(blocks).toHaveLength(0)
    })

    it('should handle missing status (default to draft)', () => {
      const markdown = `### R-1: Test
- [ ] Criterion`
      const blocks = parseRequirementBlocks(markdown)
      expect(blocks[0].status).toBe('draft')
    })
  })

  describe('parsePlanCovers', () => {
    it('should parse plan items with covers', () => {
      const plan = `
- [ ] 实现登录 API (covers: R-1)
- [x] 添加测试 (covers: R-1, R-2)
`
      const items = parsePlanCovers(plan)
      expect(items).toHaveLength(2)
      expect(items[0].covers).toEqual(['R-1'])
      expect(items[0].status).toBe('pending')
      expect(items[1].covers).toEqual(['R-1', 'R-2'])
      expect(items[1].status).toBe('completed')
    })

    it('should parse plan items with Chinese covers punctuation', () => {
      const plan = `
- [ ] T-1： 实现登录 API（covers：R-1，R-2）
- [x] 添加测试（cover：r-3）
`
      const items = parsePlanCovers(plan)

      expect(items).toHaveLength(2)
      expect(items[0].id).toBe('T-1')
      expect(items[0].covers).toEqual(['R-1', 'R-2'])
      expect(items[1].covers).toEqual(['R-3'])
      expect(items[1].status).toBe('completed')
    })

    it('should handle plan items without covers', () => {
      const plan = `
- [ ] 普通任务
- [x] 另一个任务
`
      const items = parsePlanCovers(plan)
      expect(items).toHaveLength(2)
      expect(items[0].covers).toEqual([])
    })

    it('keeps explicit T task ids for SDD Todo trace matching', () => {
      const plan = `
- [ ] T-1: Implement checkout (covers: R-1)
- [x] T-2: Add checkout tests (covers: R-1)
`
      const items = parsePlanCovers(plan)

      expect(items.map(item => item.id)).toEqual(['T-1', 'T-2'])
      expect(items[0].text).toBe('T-1: Implement checkout (covers: R-1)')
    })

    it('should handle empty plan', () => {
      const items = parsePlanCovers('')
      expect(items).toHaveLength(0)
    })
  })

  describe('computeCoverage', () => {
    it('should compute coverage correctly', () => {
      const blocks = [
        { id: 'R-1', title: 'Test 1', status: 'draft' as const, description: '', acceptanceCriteria: [], lineNumber: 1 },
        { id: 'R-2', title: 'Test 2', status: 'draft' as const, description: '', acceptanceCriteria: [], lineNumber: 5 },
        { id: 'R-3', title: 'Test 3', status: 'draft' as const, description: '', acceptanceCriteria: [], lineNumber: 9 }
      ]

      const planItems = [
        { id: 'P-1', text: 'Task 1', covers: ['R-1', 'R-2'], status: 'pending' as const, lineNumber: 1 },
        { id: 'P-2', text: 'Task 2', covers: ['R-1'], status: 'completed' as const, lineNumber: 2 }
      ]

      const { coverage, uncoveredRequirementIds } = computeCoverage(blocks, planItems)

      expect(coverage['R-1']).toEqual(['P-1', 'P-2'])
      expect(coverage['R-2']).toEqual(['P-1'])
      expect(coverage['R-3']).toEqual([])
      expect(uncoveredRequirementIds).toEqual(['R-3'])
    })
  })

  describe('deriveStatuses', () => {
    it('should derive verified when all criteria checked', () => {
      const blocks = [
        {
          id: 'R-1',
          title: 'Test',
          status: 'building' as const,
          description: '',
          acceptanceCriteria: [
            { text: 'Criterion 1', checked: true },
            { text: 'Criterion 2', checked: true }
          ],
          lineNumber: 1
        }
      ]

      const coverage = { 'R-1': ['P-1'] }
      const planStatuses = { 'P-1': 'completed' }

      const statuses = deriveStatuses(blocks, coverage, planStatuses)
      expect(statuses['R-1']).toBe('verified')
    })

    it('should derive building when plan is in progress', () => {
      const blocks = [
        {
          id: 'R-1',
          title: 'Test',
          status: 'planned' as const,
          description: '',
          acceptanceCriteria: [{ text: 'Criterion', checked: false }],
          lineNumber: 1
        }
      ]

      const coverage = { 'R-1': ['P-1'] }
      const planStatuses = { 'P-1': 'in_progress' }

      const statuses = deriveStatuses(blocks, coverage, planStatuses)
      expect(statuses['R-1']).toBe('building')
    })

    it('should derive planned when has coverage', () => {
      const blocks = [
        {
          id: 'R-1',
          title: 'Test',
          status: 'draft' as const,
          description: '',
          acceptanceCriteria: [{ text: 'Criterion', checked: false }],
          lineNumber: 1
        }
      ]

      const coverage = { 'R-1': ['P-1'] }
      const planStatuses = { 'P-1': 'pending' }

      const statuses = deriveStatuses(blocks, coverage, planStatuses)
      expect(statuses['R-1']).toBe('planned')
    })

    it('should keep original status when no coverage', () => {
      const blocks = [
        {
          id: 'R-1',
          title: 'Test',
          status: 'draft' as const,
          description: '',
          acceptanceCriteria: [],
          lineNumber: 1
        }
      ]

      const coverage = { 'R-1': [] }
      const planStatuses = {}

      const statuses = deriveStatuses(blocks, coverage, planStatuses)
      expect(statuses['R-1']).toBe('draft')
    })
  })

  describe('computeTrace', () => {
    it('should compute complete trace', () => {
      const requirementMarkdown = `
### R-1: 登录 {draft}
- [ ] 验收1

### R-2: 注册 {building}
- [x] 验收2
`
      const planMarkdown = `
- [ ] 实现登录 (covers: R-1)
- [x] 实现注册 (covers: R-2)
`

      const trace = computeTrace({
        draftId: 'test-draft',
        requirementMarkdown,
        planMarkdown
      })

      expect(trace.draftId).toBe('test-draft')
      expect(trace.requirementBlocks).toHaveLength(2)
      expect(trace.planItems).toHaveLength(2)
      expect(trace.coverage['R-1']).toEqual(['P-1'])
      expect(trace.coverage['R-2']).toEqual(['P-2'])
    })

    it('should compute trace coverage from Chinese covers punctuation', () => {
      const requirementMarkdown = `
### R-1: 登录 {draft}
- [ ] 验收1

### R-2: 注册 {draft}
- [ ] 验收2
`
      const planMarkdown = `
- [ ] T-1： 实现登录和注册（covers：R-1，R-2）
`

      const trace = computeTrace({
        draftId: 'test-draft',
        requirementMarkdown,
        planMarkdown
      })

      expect(trace.planItems[0].covers).toEqual(['R-1', 'R-2'])
      expect(trace.coverage['R-1']).toEqual(['T-1'])
      expect(trace.coverage['R-2']).toEqual(['T-1'])
      expect(trace.uncoveredRequirementIds).toEqual([])
    })
  })

  describe('computeCompletionRate', () => {
    it('should compute completion rate', () => {
      const blocks = [
        { id: 'R-1', title: '', status: 'verified' as const, description: '', acceptanceCriteria: [], lineNumber: 1 },
        { id: 'R-2', title: '', status: 'done' as const, description: '', acceptanceCriteria: [], lineNumber: 2 },
        { id: 'R-3', title: '', status: 'building' as const, description: '', acceptanceCriteria: [], lineNumber: 3 },
        { id: 'R-4', title: '', status: 'draft' as const, description: '', acceptanceCriteria: [], lineNumber: 4 }
      ]

      const result = computeCompletionRate(blocks)
      expect(result.total).toBe(4)
      expect(result.verified).toBe(1)
      expect(result.done).toBe(1)
      expect(result.building).toBe(1)
      expect(result.draft).toBe(1)
      expect(result.rate).toBe(0.5)
    })

    it('should handle empty blocks', () => {
      const result = computeCompletionRate([])
      expect(result.total).toBe(0)
      expect(result.rate).toBe(0)
    })
  })
})
