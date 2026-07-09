/**
 * Wave4 P3: built-in Firefly team orchestration templates.
 */

export type FireflyTemplateMode = 'orchestrate' | 'auto' | 'chain' | 'parallel-review'

export interface FireflyTemplateNode {
  id: string
  role: string
  label: string
}

export interface FireflyTemplateEdge {
  from: string
  to: string
}

export interface FireflyTemplate {
  id: string
  name: string
  version: number
  description?: string
  roles: string[]
  schedule: {
    nodes: FireflyTemplateNode[]
    edges: FireflyTemplateEdge[]
  }
  defaultMode: FireflyTemplateMode
}

const TEMPLATES: FireflyTemplate[] = [
  {
    id: 'firefly-five-role',
    name: 'Firefly 五角色',
    version: 1,
    description: 'Router → Main → Reviewer → Executor → Gatekeeper full chain.',
    roles: ['router', 'main', 'reviewer', 'executor', 'gatekeeper'],
    schedule: {
      nodes: [
        { id: 'n-router', role: 'router', label: 'Router' },
        { id: 'n-main', role: 'main', label: 'Main' },
        { id: 'n-reviewer', role: 'reviewer', label: 'Reviewer' },
        { id: 'n-executor', role: 'executor', label: 'Executor' },
        { id: 'n-gatekeeper', role: 'gatekeeper', label: 'Gatekeeper' }
      ],
      edges: [
        { from: 'n-router', to: 'n-main' },
        { from: 'n-main', to: 'n-reviewer' },
        { from: 'n-reviewer', to: 'n-executor' },
        { from: 'n-executor', to: 'n-gatekeeper' }
      ]
    },
    defaultMode: 'orchestrate'
  },
  {
    id: 'pair-review',
    name: '双人 Review',
    version: 1,
    description: 'Implementer produces a change; reviewer verifies before release.',
    roles: ['implementer', 'reviewer'],
    schedule: {
      nodes: [
        { id: 'n-impl', role: 'implementer', label: 'Implementer' },
        { id: 'n-review', role: 'reviewer', label: 'Reviewer' }
      ],
      edges: [{ from: 'n-impl', to: 'n-review' }]
    },
    defaultMode: 'parallel-review'
  },
  {
    id: 'solo-tdd',
    name: '单人 TDD',
    version: 1,
    description: 'Red → Green → Refactor loop for a single agent.',
    roles: ['developer'],
    schedule: {
      nodes: [
        { id: 'n-red', role: 'developer', label: 'Red (failing test)' },
        { id: 'n-green', role: 'developer', label: 'Green (implement)' },
        { id: 'n-refactor', role: 'developer', label: 'Refactor' }
      ],
      edges: [
        { from: 'n-red', to: 'n-green' },
        { from: 'n-green', to: 'n-refactor' }
      ]
    },
    defaultMode: 'chain'
  }
]

/**
 * List built-in Firefly templates (copy; safe to mutate downstream).
 */
export function listFireflyTemplates(): FireflyTemplate[] {
  return TEMPLATES.map(t => structuredClone(t))
}

/**
 * Get a single template by id, or null.
 */
export function getFireflyTemplate(id: string): FireflyTemplate | null {
  if (!id || typeof id !== 'string') return null
  const found = TEMPLATES.find(t => t.id === id)
  return found ? structuredClone(found) : null
}
