/**
 * Lorekeep server actions.
 *
 * Actions run with record RBAC OFF (see src/server/action-routes.ts), so each
 * one does its own authorization. The rule for canon is simple: only the
 * topic's creator may change it. We never trust a topicId/creator from the
 * client — we load the topic and compare its creatorId to the verified caller.
 */

import type { ActionHandler, ActionResult } from 'deepspace/worker'
import type { Env } from '../../worker'
import { CANON_KINDS } from '../schemas/lore-schemas'

type Topic = { title: string; creatorId: string }
type Proposal = {
  topicId: string
  kind: string
  name: string
  content: string
  status?: string
}

const MAX_NAME = 120
const MAX_CONTENT = 4000

function fail(error: string, code?: string): ActionResult {
  return { success: false, error, code }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** Load the topic and confirm the caller created it. */
async function requireTopicCreator(
  ctx: Parameters<ActionHandler<Env>>[0],
  topicId: string,
): Promise<ActionResult | null> {
  if (!topicId) return fail('topicId is required', 'bad_request')
  const res = await ctx.tools.get<Topic>('topics', topicId)
  if (!res.success) return fail('Topic not found', 'not_found')
  if (res.data.record.data.creatorId !== ctx.userId) {
    return fail('Only the topic creator can change the canon.', 'forbidden')
  }
  return null
}

function validateEntry(kind: string, name: string, content: string): ActionResult | null {
  if (!(CANON_KINDS as readonly string[]).includes(kind)) return fail(`Unknown kind: ${kind}`, 'bad_request')
  if (!name || name.length > MAX_NAME) return fail('Name is required (max 120 chars).', 'bad_request')
  if (!content || content.length > MAX_CONTENT) return fail('Content is required (max 4000 chars).', 'bad_request')
  return null
}

export const actions: Record<string, ActionHandler<Env>> = {
  /** Creator adds a canon entry directly. */
  async addCanonEntry(ctx) {
    const topicId = str(ctx.params.topicId)
    const kind = str(ctx.params.kind)
    const name = str(ctx.params.name)
    const content = str(ctx.params.content)
    const denied = await requireTopicCreator(ctx, topicId)
    if (denied) return denied
    const invalid = validateEntry(kind, name, content)
    if (invalid) return invalid
    return ctx.tools.create('canon_entries', { topicId, kind, name, content, origin: 'creator' })
  },

  /** Creator removes a canon entry. */
  async deleteCanonEntry(ctx) {
    const entryId = str(ctx.params.entryId)
    const entry = await ctx.tools.get<{ topicId: string }>('canon_entries', entryId)
    if (!entry.success) return fail('Entry not found', 'not_found')
    const denied = await requireTopicCreator(ctx, entry.data.record.data.topicId)
    if (denied) return denied
    return ctx.tools.remove('canon_entries', entryId)
  },

  /**
   * Creator approves or rejects a pending proposal (from a member or the AI).
   * Approval copies the proposal into canon_entries.
   */
  async reviewProposal(ctx) {
    const proposalId = str(ctx.params.proposalId)
    const decision = str(ctx.params.decision)
    if (decision !== 'approve' && decision !== 'reject') return fail('decision must be approve or reject', 'bad_request')

    const res = await ctx.tools.get<Proposal>('canon_proposals', proposalId)
    if (!res.success) return fail('Proposal not found', 'not_found')
    const p = res.data.record.data
    if (p.status && p.status !== 'pending') return fail(`Proposal is already ${p.status}.`, 'conflict')

    const denied = await requireTopicCreator(ctx, p.topicId)
    if (denied) return denied

    if (decision === 'approve') {
      const invalid = validateEntry(p.kind, p.name, p.content)
      if (invalid) return invalid
      const created = await ctx.tools.create('canon_entries', {
        topicId: p.topicId,
        kind: p.kind,
        name: p.name,
        content: p.content,
        origin: 'proposal',
      })
      if (!created.success) return created
    }
    return ctx.tools.update('canon_proposals', proposalId, {
      status: decision === 'approve' ? 'approved' : 'rejected',
    })
  },
}
