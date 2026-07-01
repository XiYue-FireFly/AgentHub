/**
 * PM Skill Frameworks - PM 技能框架
 *
 * 参照 Kun 的需求 AI 助手，把需求澄清、结构化和风险预检动作
 * 整理成可点击的提示词卡片。
 */

export type SddWorkflowStage = 'discover' | 'structure' | 'risk'

export interface SddPmFramework {
  id: string
  name: string
  stage: SddWorkflowStage
  subtitle: string
  description: string
  prompt: string
}

export const SDD_PM_FRAMEWORKS: SddPmFramework[] = [
  {
    id: 'clarify',
    name: '澄清需求',
    stage: 'discover',
    subtitle: '找出还缺的问题',
    description: '澄清开放问题，明确需求边界',
    prompt: '请帮我澄清以下需求中的开放问题：\n\n1. 这个需求的核心目标是什么？\n2. 哪些用户、场景、边界条件还不明确？\n3. 有哪些技术、业务或合规约束？\n4. 哪些问题必须在进入计划前先回答？'
  },
  {
    id: 'research',
    name: '辅助调研',
    stage: 'discover',
    subtitle: '补齐背景和方案',
    description: '调研背景、技术方案和最佳实践',
    prompt: '请帮我调研这个需求的背景和可行方案：\n\n1. 这个问题常见的解决路径有哪些？\n2. 各方案的优缺点、成本和风险是什么？\n3. 推荐的方案是什么，为什么？\n4. 还有哪些需要进一步确认的信息？'
  },
  {
    id: 'brainstorm-ideas',
    name: '多视角发散',
    stage: 'discover',
    subtitle: 'PM / 设计 / 工程三视角',
    description: '从不同角色视角发散机会和方案',
    prompt: '请从 PM、设计、工程三个视角发散这个需求：\n\n1. PM 视角：业务目标、用户价值、战略契合度是什么？\n2. 设计视角：体验、可用性、心智负担有哪些机会？\n3. 工程视角：技术杠杆、数据、可维护性如何考虑？\n\n请最后选出最值得推进的 5 个方向，并说明理由、风险假设和最小验证方式。'
  },
  {
    id: 'opportunity-tree',
    name: '机会方案树',
    stage: 'discover',
    subtitle: '目标 -> 机会 -> 方案',
    description: '围绕目标拆解机会与候选方案',
    prompt: '请用机会方案树梳理这个需求：\n\n1. 顶部写出一个可衡量的目标。\n2. 拆出 3-7 个用户机会，机会必须表达问题或未满足需求，而不是功能。\n3. 为最重要的 2-3 个机会各提出多个候选方案。\n4. 为最有潜力的方案设计一个低成本验证实验。'
  },
  {
    id: 'triage-requests',
    name: '诉求分类排序',
    stage: 'discover',
    subtitle: '归类并挑出前 3',
    description: '对多个诉求按主题归类并排序',
    prompt: '我这里有多个需求/诉求，请按主题归类，并从影响、成本、风险、战略契合度评估，选出最该先做的前 3 项，分别说明理由、备选方案、最大风险假设，以及最低成本的验证方式。'
  },
  {
    id: 'structure',
    name: 'AI 结构化需求',
    stage: 'structure',
    subtitle: '拆成 R 块并补验收标准',
    description: '将需求结构化为用户故事和验收标准',
    prompt: '请帮我将需求结构化为 SDD 需求块：\n\n### R-1: <标题>\n作为 [角色]，我想要 [功能]，以便 [价值]\n- [ ] 验收标准 1\n- [ ] 验收标准 2\n- [ ] 验收标准 3\n\n要求：每个 R 块独立、可估算、可验证，并补充关键边界条件。'
  },
  {
    id: 'wwa',
    name: 'WWA 结构化',
    stage: 'structure',
    subtitle: 'Why-What-Acceptance',
    description: '用 Why-What-Acceptance 梳理需求',
    prompt: '请用 WWA（Why-What-Acceptance）方式结构化当前需求：\n\n1. Why：为什么现在要做，连接用户或业务价值。\n2. What：要实现什么，保持意图清晰，不写过度实现细节。\n3. Acceptance：可观察、可验证的验收标准。\n\n请输出为 SDD 的 R 块格式。'
  },
  {
    id: 'job-stories',
    name: 'Job Story 化',
    stage: 'structure',
    subtitle: '情境-动机-结果',
    description: '用 JTBD 的 Job Story 改写需求',
    prompt: '请把当前需求改写为 Job Story：\n\nWhen <情境>, I want to <动机>, so I can <结果>。\n\n要求聚焦任务和情境，不只写用户角色；同时为每个 Job Story 补充可验证的验收标准。'
  },
  {
    id: 'prd',
    name: '扩写为 PRD',
    stage: 'structure',
    subtitle: '补齐背景、目标、价值',
    description: '生成产品需求文档',
    prompt: '请帮我扩写为 PRD 文档，包含：\n\n1. 背景：为什么现在要做\n2. 目标：可衡量的结果\n3. 用户和场景\n4. 价值主张\n5. 功能需求\n6. 非功能需求\n7. 验收标准\n8. 假设和风险\n\n最后把可实施的内容整理为 SDD R 块。'
  },
  {
    id: 'polish',
    name: '校对润色',
    stage: 'structure',
    subtitle: '查语法 / 逻辑 / 表达',
    description: '检查并润色需求表达',
    prompt: '请帮我校对当前需求文档，重点检查：\n\n1. 语法和表达是否清楚。\n2. 逻辑是否自洽，有无跳跃或矛盾。\n3. 验收标准是否可观察、可验证。\n4. 哪些表述需要更具体。\n\n请按“位置 / 问题 / 建议修改 / 原因”输出，不要大段重写。'
  },
  {
    id: 'assumptions',
    name: '风险假设排查',
    stage: 'risk',
    subtitle: '价值 / 可用 / 商业 / 技术',
    description: '识别和评估风险假设',
    prompt: '请帮我从四类风险识别当前需求的风险假设：\n\n1. 价值风险：它真的解决重要问题吗？\n2. 可用性风险：用户能顺利使用吗？\n3. 商业风险：业务、合规、运营是否可支撑？\n4. 技术风险：现有技术是否可行且可维护？\n\n请给出每条假设的信心等级和最低成本验证方式。'
  },
  {
    id: 'prioritize-assumptions',
    name: '假设排优先级',
    stage: 'risk',
    subtitle: '影响 x 风险矩阵',
    description: '按影响和风险排序假设',
    prompt: '请帮我对当前需求的假设排优先级：\n\n1. 为每个假设评估影响、信心、验证成本。\n2. 放入影响 x 风险矩阵。\n3. 标出哪些可以直接做、哪些必须先验证、哪些应延后或放弃。\n4. 为需要验证的假设设计一个最小实验。'
  },
  {
    id: 'pre-mortem',
    name: '事前验尸',
    stage: 'risk',
    subtitle: '想象失败，倒推风险',
    description: '假设项目失败，分析原因',
    prompt: '假设这个功能上线后失败了，请分析可能的原因：\n\n1. 技术层面可能出什么问题？\n2. 用户层面可能出什么问题？\n3. 业务或体验层面可能出什么问题？\n4. 如何预防这些问题？'
  },
  {
    id: 'experiments',
    name: '设计验证实验',
    stage: 'risk',
    subtitle: '低成本验证假设',
    description: '设计验证实验',
    prompt: '请帮我设计验证实验：\n\n1. 需要验证什么假设？\n2. 如何设计最低成本的实验？\n3. 要观察什么行为或指标？\n4. 成功标准和停止标准是什么？'
  }
]

export const SDD_FRAMEWORK_GROUPS: Array<{
  stage: SddWorkflowStage
  title: string
  description: string
}> = [
  { stage: 'discover', title: '厘清方向', description: '澄清需求、补齐方案' },
  { stage: 'structure', title: '结构成型', description: '定义需求、设计验收' },
  { stage: 'risk', title: '风险预检', description: '识别风险、设计验证' }
]

export function frameworksForStage(stage: SddWorkflowStage): SddPmFramework[] {
  return SDD_PM_FRAMEWORKS.filter((framework) => framework.stage === stage)
}
