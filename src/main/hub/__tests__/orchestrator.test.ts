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

  it('parseVerdict 识别 PASS / FAIL:原因 / 歧义宽松通过', () => {
    expect(parseVerdict('PASS')).toEqual({ pass: true })
    expect(parseVerdict('  pass, looks good')).toEqual({ pass: true })
    expect(parseVerdict('FAIL: 缺少错误处理')).toEqual({ pass: false, note: '缺少错误处理' })
    expect(parseVerdict('FAIL')).toEqual({ pass: false })
    expect(parseVerdict('看起来还行')).toEqual({ pass: true }) // 歧义→宽松通过，避免死循环
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
