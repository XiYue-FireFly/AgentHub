import { createHash } from "node:crypto"
import { store } from "../store"
import type { ThreadTodo, ThreadTodoStatus } from "./types"

const STORAGE_KEY = "runtime.todos.v1"
const MAX_TODOS = 120

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
    source: input.source ?? existing?.source,
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

export function syncTodosFromMarkdown(threadId: string, markdown: string): ThreadTodo[] {
  const items = markdown.split(/\r?\n/)
    .map(line => line.match(/^\s*[-*]\s+\[( |x|-)\]\s+(.+)$/i))
    .filter((match): match is RegExpMatchArray => !!match)
    .map(match => ({
      id: makeTodoId(threadId, match[2]),
      content: clean(match[2]),
      status: markerStatus(match[1]),
      source: {
        kind: "plan" as const,
        contentHash: hash(clean(match[2]))
      }
    }))
  return setThreadTodos(threadId, items)
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
