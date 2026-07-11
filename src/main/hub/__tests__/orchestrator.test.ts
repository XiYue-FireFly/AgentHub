import { describe, it, expect } from 'vitest'
import { parsePlan, decompositionPrompt, synthesisPrompt, verifyPrompt, parseVerdict, retryPrompt } from '../orchestrator'

describe('orchestrator helpers', () => {
  it('parsePlan 解析纯 JSON', () => {
    const p = parsePlan('{"subtasks":[{"id":"1","title":"后端","detail":"写 API","agent":"codex"},{"id":"2","title":"文档","detail":"写 README"}]}')
    expect(p?.subtasks.length).toBe(2)
    expect(p?.subtasks[0]).toMatchObject({ id: '1', agentId: 'codex' })
    expect(p?.subtasks[1].agentId).toBeUndefined()
  })

  it('parsePlan 剥离 ```json 围栏并忽略前后散文', () => {
    const raw = '好的，计划如下：\n```json\n{"subtasks":[{"id":"a","detail":"做事"}]}\n```\n完成。'
    const p = parsePlan(raw)
    expect(p?.subtasks[0].id).toBe('a')
    expect(p?.subtasks[0].detail).toBe('做事')
  })

  it('parsePlan 过滤未知 agent', () => {
    const p = parsePlan('{"subtasks":[{"id":"1","detail":"x","agent":"not-an-agent"}]}')
    expect(p?.subtasks[0].agentId).toBeUndefined()
  })

  it('parsePlan 对坏输入返回 null', () => {
    expect(parsePlan('没有 json')).toBeNull()
    expect(parsePlan('{"subtasks":[]}')).toBeNull()
    expect(parsePlan('')).toBeNull()
  })

  it('parsePlan 将超大计划限制为最多 5 个子任务', () => {
    const raw = JSON.stringify({
      subtasks: Array.from({ length: 100 }, (_, index) => ({
        id: String(index + 1),
        title: `任务 ${index + 1}`,
        detail: `执行任务 ${index + 1}`
      }))
    })

    const plan = parsePlan(raw)

    expect(plan?.subtasks).toHaveLength(5)
    expect(plan?.subtasks.map(subtask => subtask.id)).toEqual(['1', '2', '3', '4', '5'])
  })

  it('parsePlan 去重重复 ID 并限制所有文本字段长度', () => {
    const longId = 'i'.repeat(200)
    const raw = JSON.stringify({
      subtasks: [
        { id: longId, title: 't'.repeat(200), detail: 'd'.repeat(5000), agent: 'codex' },
        { id: longId, title: '重复任务', detail: '不应保留', agent: 'codex' }
      ]
    })

    const plan = parsePlan(raw)

    expect(plan?.subtasks).toHaveLength(1)
    expect(plan?.subtasks[0].id.length).toBeLessThanOrEqual(64)
    expect(plan?.subtasks[0].title.length).toBeLessThanOrEqual(80)
    expect(plan?.subtasks[0].detail?.length).toBeLessThanOrEqual(4000)
  })

  it('parsePlan 保留截断后冲突的不同长 ID，同时继续去重真正重复的原始 ID', () => {
    const sharedPrefix = 'x'.repeat(64)
    const firstId = `${sharedPrefix}-first`
    const secondId = `${sharedPrefix}-second`
    const raw = JSON.stringify({
      subtasks: [
        { id: firstId, title: '任务一', detail: '执行一' },
        { id: secondId, title: '任务二', detail: '执行二' },
        { id: firstId, title: '重复任务', detail: '不应保留' }
      ]
    })

    const plan = parsePlan(raw)
    const ids = plan?.subtasks.map(subtask => subtask.id) || []

    expect(plan?.subtasks.map(subtask => subtask.detail)).toEqual(['执行一', '执行二'])
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    expect(ids.every(id => id.length <= 64)).toBe(true)
  })

  it('decompositionPrompt 含任务文本与 JSON 指令', () => {
    const s = decompositionPrompt('做个网站')
    expect(s).toContain('做个网站')
    expect(s).toContain('"subtasks"')
  })

  it('synthesisPrompt 含各子任务块与失败标注', () => {
    const s = synthesisPrompt('需求', [
      { title: 'A', agentId: 'codex', content: '结果A' },
      { title: 'B', content: '', error: '超时' }
    ])
    expect(s).toContain('结果A')
    expect(s).toContain('超时')
    expect(s).toContain('需求')
  })

  it('parseVerdict 识别 PASS / FAIL:原因 / 歧义默认不通过', () => {
    expect(parseVerdict('PASS')).toEqual({ pass: true })
    expect(parseVerdict('  pass, looks good')).toEqual({ pass: true })
    expect(parseVerdict('FAIL: 缺少错误处理')).toEqual({ pass: false, note: '缺少错误处理' })
    expect(parseVerdict('FAIL')).toEqual({ pass: false })
    expect(parseVerdict('看起来还行')).toEqual({ pass: false, note: 'ambiguous verify output' })
  })

  it('verifyPrompt 含子任务与结果、要求单行判定', () => {
    const s = verifyPrompt('写函数', '实现加法', 'function add(a,b){return a+b}')
    expect(s).toContain('写函数')
    expect(s).toContain('function add')
    expect(s).toMatch(/PASS|FAIL/)
  })

  it('retryPrompt 把失败原因前置', () => {
    expect(retryPrompt('做这件事', '漏了边界情况')).toContain('漏了边界情况')
    expect(retryPrompt('做这件事', undefined)).toContain('做这件事')
  })
})
