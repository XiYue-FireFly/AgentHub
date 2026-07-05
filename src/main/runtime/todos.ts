import { createHash } from "node:crypto"
import { store } from "../store"
import type { ThreadTodo, ThreadTodoStatus } from "./types"

const STORAGE_KEY = "runtime.todos.v1"
const MAX_TODOS = 120
const PLAN_COVERS_RE = /[（(]\s*covers?\s*[:：]\s*([^)）]+)\s*[)）]/i

const PLAN_ITEM_ID_RE = /^(T-\d+|P-\d+)\s*[:：]\s+/i

interface TodoState {
  version: 1
  todos: ThreadTodo[]
}

export function listThreadTodos(threadId: string): ThreadTodo[] {
  return read().todos.filter(todo => todo.threadId === threadId).sort((a, b) => b.updatedAt - a.updatedAt)
}

export function setThreadTodos(threadId: string, todos: Array<Pick<ThreadTodo, "id" | "content" | "status" | "source">>): ThreadTodo[] {
  const now = Date.now()
  const state = read()
  const next = todos.slice(0, MAX_TODOS).map(todo => ({
    id: todo.id || makeTodoId(threadId, todo.content),
    threadId,
    content: clean(todo.content),
    status: normalizeStatus(todo.status),
    source: todo.source,
    updatedAt: now
  }))
  state.todos = [...state.todos.filter(todo => todo.threadId !== threadId), ...next]
  write(state)
  return listThreadTodos(threadId)
}

export function upsertThreadTodo(input: { threadId: string; id?: string; content: string; status?: ThreadTodoStatus; source?: ThreadTodo["source"] }): ThreadTodo {
  const state = read()
  const now = Date.now()
  const id = input.id || makeTodoId(input.threadId, input.content)
  const existing = state.todos.find(todo => todo.threadId === input.threadId && todo.id === id)
  const todo: ThreadTodo = {
    id,
    threadId: input.threadId,
    content: clean(input.content),
    status: normalizeStatus(input.status || existing?.status || "pending"),
    source: input.source ? { ...existing?.source, ...input.source } : existing?.source,
    updatedAt: now
  }
  state.todos = [todo, ...state.todos.filter(item => !(item.threadId === input.threadId && item.id === id))].slice(0, 2000)
  write(state)
  return todo
}

export function deleteThreadTodo(threadId: string, todoId: string): boolean {
  const state = read()
  const before = state.todos.length
  state.todos = state.todos.filter(todo => !(todo.threadId === threadId && todo.id === todoId))
  write(state)
  return before !== state.todos.length
}

export function clearThreadTodos(threadId: string): boolean {
  const state = read()
  const before = state.todos.length
  state.todos = state.todos.filter(todo => todo.threadId !== threadId)
  write(state)
  return before !== state.todos.length
}

export function syncTodosFromMarkdown(
  threadId: string,
  markdown: string,
  sourceContext: Pick<NonNullable<ThreadTodo["source"]>, "workspaceRoot" | "draftId" | "relativePath"> = {}
): ThreadTodo[] {
  let checklistIndex = 0
  const parsedItems = markdown.split(/\r?\n/)
    .map(line => {
      const match = line.match(/^\s*[-*]\s+\[( |x|-)\]\s+(.+)$/i)
      if (!match) return null
      checklistIndex += 1
      return { marker: match[1], content: match[2], fallbackPlanItemId: `P-${checklistIndex}` }
    })
    .filter((item): item is { marker: string; content: string; fallbackPlanItemId: string } => !!item)
    .filter(item => hasPlanCovers(item.content))
    .map(item => ({
      id: makeTodoId(threadId, item.content),
      content: clean(item.content),
      status: markerStatus(item.marker),
      source: {
        kind: "plan" as const,
        threadId,
        ...sourceContext,
        planItemId: planItemIdFromContent(item.content) || item.fallbackPlanItemId,
        contentHash: hash(clean(item.content))
      }
    }))
  return syncPlanTodos(threadId, parsedItems, { kind: "plan", threadId, ...sourceContext })
}

function planItemIdFromContent(value: string): string | undefined {
  const match = PLAN_ITEM_ID_RE.exec(clean(value))
  return match?.[1]?.toUpperCase()
}

function syncPlanTodos(
  threadId: string,
  items: Array<Pick<ThreadTodo, "id" | "content" | "status" | "source">>,
  scopeSource?: ThreadTodo["source"]
): ThreadTodo[] {
  const state = read()
  const now = Date.now()
  const existingThreadTodos = state.todos.filter(todo => todo.threadId === threadId)
  const effectiveScopeSource = items[0]?.source ?? scopeSource
  const incoming = items.slice(0, MAX_TODOS).map(item => {
    const source = item.source
    const existing = existingThreadTodos.find(todo =>
      todo.id === item.id ||
      (
        samePlanScope(todo.source, source) &&
        !!todo.source?.planItemId &&
        todo.source.planItemId === source?.planItemId
      )
    )
    return {
      id: existing?.id || item.id,
      threadId,
      content: clean(item.content),
      status: mergePlanStatus(existing?.status, normalizeStatus(item.status)),
      source: source ? { ...existing?.source, ...source } : existing?.source,
      updatedAt: now
    }
  })

  state.todos = [
    ...state.todos.filter(todo => !(todo.threadId === threadId && samePlanScope(todo.source, effectiveScopeSource))),
    ...incoming
  ].slice(0, 2000)
  write(state)
  return listThreadTodos(threadId)
}

function samePlanScope(left: ThreadTodo["source"] | undefined, right: ThreadTodo["source"] | undefined): boolean {
  if (left?.kind !== "plan" || right?.kind !== "plan") return false
  const scopedKeys = (["workspaceRoot", "draftId", "relativePath"] as const).filter(key => right[key])
  if (scopedKeys.length === 0) return !left.workspaceRoot && !left.draftId && !left.relativePath
  return scopedKeys.every(key => left[key] === right[key])
}

function mergePlanStatus(existing: ThreadTodoStatus | undefined, incoming: ThreadTodoStatus): ThreadTodoStatus {
  if (existing === "completed" || incoming === "completed") return "completed"
  if (existing === "in_progress" || incoming === "in_progress") return "in_progress"
  return "pending"
}

function hasPlanCovers(value: string): boolean {
  const covers = PLAN_COVERS_RE.exec(value)
  if (!covers) return false
  return covers[1]
    .split(/[,，、]/)
    .map(item => item.trim())
    .some(item => /^R-\d+$/i.test(item))
}

function read(): TodoState {
  const raw = store.get(STORAGE_KEY)
  return raw && typeof raw === "object" && Array.isArray((raw as any).todos)
    ? { version: 1, todos: (raw as any).todos }
    : { version: 1, todos: [] }
}

function write(state: TodoState): void {
  store.set(STORAGE_KEY, state)
}

function makeTodoId(threadId: string, content: string): string {
  return `todo-${hash(`${threadId}:${clean(content)}`).slice(0, 16)}`
}

function hash(value: string): string {
  return createHash("sha1").update(value).digest("hex")
}

function clean(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 240)
}

function normalizeStatus(value: string): ThreadTodoStatus {
  if (value === "in_progress" || value === "completed") return value
  return "pending"
}

function markerStatus(marker: string): ThreadTodoStatus {
  if (marker.toLowerCase() === "x") return "completed"
  if (marker === "-") return "in_progress"
  return "pending"
}
