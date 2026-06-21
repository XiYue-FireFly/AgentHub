/**
 * Workflow Center: manage workflow definitions.
 *
 * Workflows are reusable multi-step task templates that combine
 * prompts, agent selections, and skill configurations.
 * Persisted via store key `workflows.library.v1`.
 */

import { store } from '../store'

const STORAGE_KEY = 'workflows.library.v1'

export type WorkflowStepType = 'prompt' | 'agent' | 'skill' | 'review' | 'gate'

export interface WorkflowStep {
  id: string
  type: WorkflowStepType
  label: string
  /** Agent to use for this step (optional, uses default if omitted) */
  agentId?: string
  /** Prompt template for this step */
  prompt?: string
  /** Skill to inject */
  skillId?: string
  /** Dependencies: step IDs that must complete before this step */
  dependsOn?: string[]
  /** Whether this step requires approval before execution */
  requiresApproval?: boolean
}

export interface WorkflowDefinition {
  id: string
  name: string
  description: string
  category: 'development' | 'review' | 'research' | 'deployment' | 'custom'
  steps: WorkflowStep[]
  tags: string[]
  createdAt: string
  updatedAt: string
  useCount: number
  /** Whether this workflow is pinned for quick access */
  pinned?: boolean
}

export interface WorkflowLibraryData {
  version: 1
  workflows: WorkflowDefinition[]
}

function emptyLibrary(): WorkflowLibraryData { return { version: 1, workflows: [] } }

function readLibrary(): WorkflowLibraryData {
  const raw: any = store.get(STORAGE_KEY)
  if (!raw || typeof raw !== 'object') return emptyLibrary()
  const workflows = Array.isArray(raw.workflows) ? raw.workflows.filter((w: any) => w?.id && w?.name) : []
  return { version: 1, workflows }
}

function writeLibrary(data: WorkflowLibraryData): void { store.set(STORAGE_KEY, data) }

export function listWorkflows(category?: WorkflowDefinition['category']): WorkflowDefinition[] {
  const lib = readLibrary()
  return category ? lib.workflows.filter(w => w.category === category) : lib.workflows
}

export function getWorkflow(id: string): WorkflowDefinition | null {
  return readLibrary().workflows.find(w => w.id === id) || null
}

export function upsertWorkflow(input: Partial<WorkflowDefinition> & { name: string; steps: WorkflowStep[] }): WorkflowDefinition {
  const lib = readLibrary()
  const now = new Date().toISOString()
  const id = input.id || `wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const existing = lib.workflows.findIndex(w => w.id === id)
  const entry: WorkflowDefinition = {
    id,
    name: input.name,
    description: input.description || '',
    category: input.category || 'custom',
    steps: input.steps,
    tags: input.tags || [],
    createdAt: existing >= 0 ? lib.workflows[existing].createdAt : now,
    updatedAt: now,
    useCount: existing >= 0 ? lib.workflows[existing].useCount : 0,
    pinned: input.pinned
  }
  if (existing >= 0) lib.workflows[existing] = entry
  else lib.workflows.push(entry)
  writeLibrary(lib)
  return entry
}

export function deleteWorkflow(id: string): boolean {
  const lib = readLibrary()
  const before = lib.workflows.length
  lib.workflows = lib.workflows.filter(w => w.id !== id)
  if (lib.workflows.length !== before) { writeLibrary(lib); return true }
  return false
}

export function incrementWorkflowUse(id: string): void {
  const lib = readLibrary()
  const wf = lib.workflows.find(w => w.id === id)
  if (wf) { wf.useCount++; wf.updatedAt = new Date().toISOString(); writeLibrary(lib) }
}

export function searchWorkflows(query: string): WorkflowDefinition[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return readLibrary().workflows
  return readLibrary().workflows.filter(w =>
    w.name.toLowerCase().includes(needle) ||
    w.description.toLowerCase().includes(needle) ||
    w.tags.some(t => t.toLowerCase().includes(needle))
  )
}

/** Seed default workflows for first-run experience. */
export function seedDefaultWorkflows(): void {
  const lib = readLibrary()
  if (lib.workflows.length > 0) return
  const now = new Date().toISOString()
  lib.workflows = [
    {
      id: 'wf-code-review',
      name: 'Code Review Pipeline',
      description: 'Review code for bugs, security, and style issues.',
      category: 'review',
      steps: [
        { id: 'analyze', type: 'prompt', label: 'Analyze code', prompt: 'Analyze the following code for issues.' },
        { id: 'review', type: 'review', label: 'Review findings', dependsOn: ['analyze'] },
        { id: 'gate', type: 'gate', label: 'Approval gate', dependsOn: ['review'], requiresApproval: true }
      ],
      tags: ['review', 'code', 'quality'],
      createdAt: now, updatedAt: now, useCount: 0, pinned: true
    },
    {
      id: 'wf-tdd-feature',
      name: 'TDD Feature Implementation',
      description: 'Test-driven development workflow: write tests first, then implement.',
      category: 'development',
      steps: [
        { id: 'plan', type: 'prompt', label: 'Plan implementation' },
        { id: 'tests', type: 'prompt', label: 'Write tests', prompt: 'Write failing tests for the planned feature.', dependsOn: ['plan'] },
        { id: 'implement', type: 'agent', label: 'Implement to pass', dependsOn: ['tests'] },
        { id: 'verify', type: 'review', label: 'Verify all tests pass', dependsOn: ['implement'] }
      ],
      tags: ['tdd', 'development', 'testing'],
      createdAt: now, updatedAt: now, useCount: 0, pinned: true
    }
  ]
  writeLibrary(lib)
}
