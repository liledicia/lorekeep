/** Shared Lorekeep types and small client helpers. */

import { getAuthToken } from 'deepspace'

export type Topic = { title: string; premise?: string; tags?: string; creatorId: string; creatorName?: string }
export type CanonKind = 'character' | 'relationship' | 'world' | 'timeline'
export type CanonEntry = { topicId: string; kind: CanonKind; name: string; content: string; origin?: string }
export type Proposal = {
  topicId: string
  kind: CanonKind
  name: string
  content: string
  reason?: string
  source?: 'member' | 'ai'
  sourcePassageId?: string
  proposedBy: string
  proposerName?: string
  status?: 'pending' | 'approved' | 'rejected'
}
export type Passage = { topicId: string; title: string; body?: string; authorId: string; authorName?: string }
export type Comment = { passageId: string; topicId: string; body: string; quote?: string; authorId: string; authorName?: string }

export const CANON_KIND_LABELS: Record<CanonKind, string> = {
  character: 'Characters',
  relationship: 'Relationships',
  world: 'World rules',
  timeline: 'Timeline',
}

export function parseTags(tags?: string): string[] {
  return (tags ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
}

export function normalizeTags(input: string): string {
  return Array.from(new Set(parseTags(input).map((t) => t.replace(/\s+/g, '-')))).join(',')
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken()
  if (!token) throw new Error('Please sign in first.')
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

/** Call a server action from src/actions. Throws with the server's message on failure. */
export async function callAction<T = unknown>(name: string, params: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/api/actions/${name}`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(params),
  })
  const json = (await res.json().catch(() => ({}))) as { success?: boolean; data?: T; error?: string }
  if (!res.ok || json.success === false) throw new Error(json.error ?? `Request failed (${res.status})`)
  return json.data as T
}

/** POST to an AI route and stream plain-text chunks into onChunk. */
export async function streamAi(
  path: '/api/lore/continue' | '/api/lore/suggest-canon',
  body: Record<string, unknown>,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(path, { method: 'POST', headers: await authHeaders(), body: JSON.stringify(body), signal })
  if (!res.ok || !res.body) {
    const json = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(json.error ?? `AI request failed (${res.status})`)
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    if (value) onChunk(value)
  }
}

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
