/**
 * Lorekeep AI routes — the core of the app.
 *
 *   POST /api/lore/continue        { passageId, draft, instruction? }  → streamed prose
 *   POST /api/lore/suggest-canon   { passageId, draft }                → streamed summary,
 *                                                                        proposals appear live
 *
 * How it works:
 * - The model never gets the canon pasted into its prompt. It gets a small set
 *   of TOPIC-BOUND tools (read_canon, list_passages, read_passage, and in
 *   suggest mode propose_canon) and looks things up itself.
 * - Every tool runs through `createUserToolExecutor`, i.e. AS the signed-in
 *   user with the record room's normal RBAC. So the AI can only read what the
 *   user can read, and a proposal it writes is a normal member proposal
 *   (stamped with the user's id) that still needs the topic creator's
 *   approval. The AI cannot write canon directly — nobody can.
 * - Only the passage's author can run the AI on it (checked here), and the
 *   topicId the tools are bound to comes from the stored passage, never from
 *   the request body.
 */

import type { Hono } from 'hono'
import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod/v4'
import {
  createUserToolExecutor,
  deepSpaceAgentErrorSummary,
  loggableError,
  resolveAppMembership,
  streamDeepSpaceAgent,
} from 'deepspace/worker'
import { CANON_KINDS } from '../schemas/lore-schemas.js'
import { resolveAuth } from './http-routes.js'
import type { AppContext, Env } from '../../worker.js'

const MAX_DRAFT = 40_000
const MAX_INSTRUCTION = 1_000

type Exec = ReturnType<typeof createUserToolExecutor>
type Rec<T> = { recordId: string; data: T; createdBy: string }
type Passage = { topicId: string; title: string; body?: string; authorId: string; authorName?: string }

/** Tool results come back as `{ success, data }` envelopes; unwrap defensively. */
function unwrap(res: unknown): Record<string, unknown> {
  const r = res as { success?: boolean; data?: unknown; error?: string }
  if (r && r.success === false) throw new Error(r.error ?? 'tool call failed')
  return ((r && 'data' in r ? r.data : r) ?? {}) as Record<string, unknown>
}

async function getRecord<T>(exec: Exec, collection: string, recordId: string): Promise<Rec<T> | null> {
  try {
    const data = unwrap(await exec('records.get', { collection, recordId }))
    return (data.record as Rec<T>) ?? null
  } catch {
    return null
  }
}

async function queryRecords<T>(exec: Exec, collection: string, where: Record<string, unknown>, limit: number) {
  const data = unwrap(await exec('records.query', { collection, where, limit, orderBy: 'createdAt', orderDir: 'asc' }))
  return ((data.records as Rec<T>[]) ?? [])
}

function buildLoreTools(exec: Exec, topicId: string, passageId: string, mode: 'continue' | 'suggest', proposerName: string): ToolSet {
  const tools: ToolSet = {
    read_canon: tool({
      description:
        "Read this topic's approved canon: characters, relationships, world rules and timeline. Call this before writing.",
      inputSchema: z.object({}),
      execute: async () => {
        const rows = await queryRecords<{ kind: string; name: string; content: string }>(exec, 'canon_entries', { topicId }, 200)
        return rows.map((r) => ({ kind: r.data.kind, name: r.data.name, content: r.data.content }))
      },
    }),
    list_passages: tool({
      description: 'List other passages written in this topic (title, author, short excerpt).',
      inputSchema: z.object({}),
      execute: async () => {
        const rows = await queryRecords<Passage>(exec, 'passages', { topicId }, 40)
        return rows
          .filter((r) => r.recordId !== passageId)
          .map((r) => ({
            passageId: r.recordId,
            title: r.data.title,
            author: r.data.authorName ?? 'unknown',
            excerpt: (r.data.body ?? '').slice(0, 400),
          }))
      },
    }),
    read_passage: tool({
      description: 'Read the full text of another passage in this topic, by passageId from list_passages.',
      inputSchema: z.object({ passageId: z.string() }),
      execute: async ({ passageId: id }) => {
        const rec = await getRecord<Passage>(exec, 'passages', id)
        if (!rec || rec.data.topicId !== topicId) return { error: 'No such passage in this topic.' }
        return { title: rec.data.title, author: rec.data.authorName ?? 'unknown', body: (rec.data.body ?? '').slice(0, 12_000) }
      },
    }),
  }

  if (mode === 'suggest') {
    tools.propose_canon = tool({
      description:
        'Propose ONE new canon fact that the passage establishes and the canon does not yet have. It goes to the topic creator for review; it is not canon until approved.',
      inputSchema: z.object({
        kind: z.enum(CANON_KINDS),
        name: z.string().min(1).max(120).describe('Short label, e.g. a character name or "The Salt Treaty"'),
        content: z.string().min(1).max(1500).describe('The fact itself, written as a canon entry'),
        reason: z.string().max(300).describe('Which line of the passage establishes it'),
      }),
      execute: async (input) => {
        const res = unwrap(
          await exec('records.create', {
            collection: 'canon_proposals',
            data: { ...input, topicId, source: 'ai', sourcePassageId: passageId, proposerName },
          }),
        )
        return { proposed: input.name, recordId: res.recordId }
      },
    })
  }
  return tools
}

const CONTINUE_INSTRUCTIONS = [
  'You are the co-writer inside Lorekeep, a shared-canon fiction app.',
  'Several writers share one canon (characters, relationships, world rules, timeline) and each writes their own passages.',
  'Your job: continue the AUTHOR\'S draft so it stays consistent with the canon.',
  '',
  'Process:',
  '1. Call read_canon first. If the draft references events or people you do not recognise, call list_passages / read_passage.',
  '2. Then write the continuation.',
  '',
  'Output rules:',
  '- Output ONLY the new prose that comes right after the draft. No preamble, no notes, no headings, no quotation of the draft.',
  '- Do not narrate your tool use.',
  '- Match the draft\'s language (e.g. Chinese drafts get Chinese prose), tense, POV and voice.',
  '- About 150–350 words unless the author\'s instruction says otherwise.',
  '- Never contradict canon. If the instruction would contradict canon, follow canon.',
].join('\n')

const SUGGEST_INSTRUCTIONS = [
  'You are the canon keeper inside Lorekeep, a shared-canon fiction app.',
  'Compare the author\'s passage with the approved canon and propose new canon facts the passage establishes.',
  '',
  'Process:',
  '1. Call read_canon.',
  '2. For each NEW, durable fact in the passage (a new named character, a relationship change, a world rule, a dated event) that is not already in canon, call propose_canon once. Propose at most 4. Skip trivia.',
  '3. Do not propose anything that contradicts canon; instead mention the contradiction in your summary.',
  '',
  'Finally reply with a 1–3 sentence summary for the author: what you proposed, and any contradictions with canon you noticed.',
  'Reply in the passage\'s language.',
].join('\n')

export function registerLoreAiRoutes(app: Hono<AppContext>): void {
  const handle = (mode: 'continue' | 'suggest') => async (c: import('hono').Context<AppContext>) => {
    const auth = await resolveAuth(c.req.raw, c.env)
    if (!auth) return c.json({ error: 'Sign in to use the AI.' }, 401)
    const membership = await resolveAppMembership(c.env, auth.userId, c.req.raw.signal)
    if (!membership) return c.json({ error: 'Temporarily unavailable' }, 503)
    if (!membership.member) return c.json({ error: 'Forbidden' }, 403)

    const body = await c.req
      .json<{ passageId?: unknown; draft?: unknown; instruction?: unknown }>()
      .catch(() => ({}) as Record<string, unknown>)
    const passageId = typeof body.passageId === 'string' ? body.passageId : ''
    const draft = typeof body.draft === 'string' ? body.draft : ''
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : ''
    if (!passageId) return c.json({ error: 'passageId is required' }, 400)
    if (draft.length > MAX_DRAFT) return c.json({ error: 'Draft is too long for the AI (40k chars).' }, 413)
    if (instruction.length > MAX_INSTRUCTION) return c.json({ error: 'Instruction is too long.' }, 413)

    const exec = createUserToolExecutor(c.env, auth.userId, c.req.raw.signal)
    const passage = await getRecord<Passage>(exec, 'passages', passageId)
    if (!passage) return c.json({ error: 'Passage not found' }, 404)
    // The AI is billed to the app owner, so only a passage's author may run it on that passage.
    if (passage.data.authorId !== auth.userId) {
      return c.json({ error: 'Only the author can use the AI on this passage.' }, 403)
    }
    if (mode === 'suggest' && draft.trim().length < 40) {
      return c.json({ error: 'Write a bit more before asking for canon suggestions.' }, 400)
    }

    const topicId = passage.data.topicId
    const tools = buildLoreTools(exec, topicId, passageId, mode, passage.data.authorName ?? '')
    const userText =
      mode === 'continue'
        ? [
            `Passage title: ${passage.data.title}`,
            instruction ? `Author's instruction for this continuation: ${instruction}` : 'No extra instruction.',
            '',
            'Draft so far (continue right after its last line):',
            '<<<',
            draft.trim() || '(empty — write an opening that fits the canon)',
            '>>>',
          ].join('\n')
        : [`Passage title: ${passage.data.title}`, '', 'Passage:', '<<<', draft.trim(), '>>>'].join('\n')

    try {
      // No authToken: developer-billed, so reviewers without DeepSpace credits can try it.
      const { result } = streamDeepSpaceAgent(c.env, {
        profile: 'application',
        instructions: mode === 'continue' ? CONTINUE_INSTRUCTIONS : SUGGEST_INSTRUCTIONS,
        messages: [{ role: 'user', content: userText }],
        tools,
        maxOutputTokens: 1500,
        abortSignal: c.req.raw.signal,
        onError: ({ error }) => {
          console.error(`[lore-ai:${mode}] ${deepSpaceAgentErrorSummary(error)}`)
        },
      })
      return new Response(result.textStream.pipeThrough(new TextEncoderStream()), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    } catch (err) {
      console.error(`[lore-ai:${mode}] failed to start: ${loggableError(err)}`)
      return c.json({ error: 'The AI could not start. Try again in a moment.' }, 502)
    }
  }

  app.post('/api/lore/continue', handle('continue'))
  app.post('/api/lore/suggest-canon', handle('suggest'))
}
