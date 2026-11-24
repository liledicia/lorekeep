/**
 * Lorekeep collections.
 *
 * Trust model in one paragraph:
 * - Anyone (even signed out) can READ topics, canon, passages, comments and
 *   proposals — Lorekeep is a public reading room.
 * - Signed-in members CREATE topics, passages, comments and canon proposals.
 *   Author columns are `userBound`, so the server stamps the caller's id and a
 *   client can't write as someone else.
 * - Only the author can UPDATE/DELETE their own passage or comment (`'own'`).
 * - Nobody writes canon_entries directly, and nobody flips a proposal's
 *   status from the client. Those go through server actions in
 *   src/actions/index.ts, which check "caller is the topic's creator".
 */

import type { CollectionSchema } from 'deepspace/schema'

const anonReadOnly = { read: true, create: false, update: false, delete: false } as const
const adminAll = { read: true, create: true, update: true, delete: true } as const

export const topicsSchema: CollectionSchema = {
  name: 'topics',
  columns: [
    { name: 'title', storage: 'text', interpretation: 'plain', required: true },
    { name: 'premise', storage: 'text', interpretation: 'plain' },
    // Comma-separated lowercase tags, e.g. "enemies-to-lovers,fantasy"
    { name: 'tags', storage: 'text', interpretation: 'plain' },
    { name: 'creatorId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true },
    { name: 'creatorName', storage: 'text', interpretation: 'plain' },
  ],
  ownerField: 'creatorId',
  permissions: {
    '*': anonReadOnly,
    viewer: anonReadOnly,
    member: {
      read: true,
      create: true,
      update: 'own',
      delete: 'own',
      writableFields: ['title', 'premise', 'tags', 'creatorName'],
    },
    admin: adminAll,
  },
}

export const CANON_KINDS = ['character', 'relationship', 'world', 'timeline'] as const

export const canonEntriesSchema: CollectionSchema = {
  name: 'canon_entries',
  columns: [
    { name: 'topicId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'kind', storage: 'text', interpretation: 'plain', required: true },
    { name: 'name', storage: 'text', interpretation: 'plain', required: true },
    { name: 'content', storage: 'text', interpretation: 'plain', required: true },
    // Where the entry came from: 'creator' (typed in) or 'proposal' (approved).
    { name: 'origin', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    '*': anonReadOnly,
    viewer: anonReadOnly,
    // Read-only from the client: every write is a creator-checked server action.
    member: anonReadOnly,
    admin: adminAll,
  },
}

export const canonProposalsSchema: CollectionSchema = {
  name: 'canon_proposals',
  columns: [
    { name: 'topicId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'kind', storage: 'text', interpretation: 'plain', required: true },
    { name: 'name', storage: 'text', interpretation: 'plain', required: true },
    { name: 'content', storage: 'text', interpretation: 'plain', required: true },
    { name: 'reason', storage: 'text', interpretation: 'plain' },
    // 'member' or 'ai' — AI proposals are still created AS the user who asked.
    { name: 'source', storage: 'text', interpretation: 'plain' },
    { name: 'sourcePassageId', storage: 'text', interpretation: 'plain' },
    { name: 'proposedBy', storage: 'text', interpretation: 'plain', userBound: true, immutable: true },
    { name: 'proposerName', storage: 'text', interpretation: 'plain' },
    // pending | approved | rejected — not in writableFields, so only actions set it.
    { name: 'status', storage: 'text', interpretation: 'plain', default: 'pending' },
  ],
  ownerField: 'proposedBy',
  permissions: {
    '*': anonReadOnly,
    viewer: anonReadOnly,
    member: {
      read: true,
      create: true,
      update: false,
      delete: 'own',
      writableFields: [
        'topicId',
        'kind',
        'name',
        'content',
        'reason',
        'source',
        'sourcePassageId',
        'proposerName',
      ],
    },
    admin: adminAll,
  },
}

export const passagesSchema: CollectionSchema = {
  name: 'passages',
  columns: [
    { name: 'topicId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'title', storage: 'text', interpretation: 'plain', required: true },
    { name: 'body', storage: 'text', interpretation: 'plain' },
    { name: 'authorId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true },
    { name: 'authorName', storage: 'text', interpretation: 'plain' },
  ],
  ownerField: 'authorId',
  permissions: {
    '*': anonReadOnly,
    viewer: anonReadOnly,
    // Other members can read a passage but never edit it — enforced by the
    // record room, not by hiding a button.
    member: {
      read: true,
      create: true,
      update: 'own',
      delete: 'own',
      writableFields: ['topicId', 'title', 'body', 'authorName'],
    },
    admin: adminAll,
  },
}

export const commentsSchema: CollectionSchema = {
  name: 'comments',
  columns: [
    { name: 'passageId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'topicId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'body', storage: 'text', interpretation: 'plain', required: true },
    // Optional quoted line from the passage the comment is about.
    { name: 'quote', storage: 'text', interpretation: 'plain' },
    { name: 'authorId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true },
    { name: 'authorName', storage: 'text', interpretation: 'plain' },
  ],
  ownerField: 'authorId',
  permissions: {
    '*': anonReadOnly,
    viewer: anonReadOnly,
    member: {
      read: true,
      create: true,
      update: 'own',
      delete: 'own',
      writableFields: ['passageId', 'topicId', 'body', 'quote', 'authorName'],
    },
    admin: adminAll,
  },
}

export const loreSchemas: CollectionSchema[] = [
  topicsSchema,
  canonEntriesSchema,
  canonProposalsSchema,
  passagesSchema,
  commentsSchema,
]
