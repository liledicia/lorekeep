/**
 * The canon sidebar: approved entries grouped by kind, the pending-proposal
 * queue, and the forms to add (creator) or propose (everyone else).
 *
 * Approve/reject/add/delete call server actions that re-check "caller is the
 * topic creator" — the buttons are only hidden for convenience.
 */

import { useState } from 'react'
import { useAuth, useAuthProfileReady, useMutations, useQuery } from 'deepspace'
import { Check, Sparkles, Trash2, X } from 'lucide-react'
import { Badge, Button, Input, Textarea, useToast } from '@/components/ui'
import { SignedInOnly } from './SignInPrompt'
import { CANON_KIND_LABELS, callAction, type CanonEntry, type CanonKind, type Proposal } from '@/lib/lore'

const KINDS = Object.keys(CANON_KIND_LABELS) as CanonKind[]

export function CanonPanel({ topicId, isCreator }: { topicId: string; isCreator: boolean }) {
  const { records: entries, status } = useQuery<CanonEntry>('canon_entries', {
    where: { topicId },
    orderBy: 'createdAt',
    orderDir: 'asc',
    limit: 300,
  })
  const { records: proposals } = useQuery<Proposal>('canon_proposals', {
    where: { topicId, status: 'pending' },
    orderBy: 'createdAt',
    orderDir: 'desc',
    limit: 100,
  })
  const { error } = useToast()

  const removeEntry = async (entryId: string, name: string) => {
    if (!window.confirm(`Remove “${name}” from the canon?`)) return
    try {
      await callAction('deleteCanonEntry', { entryId })
    } catch (err) {
      error('Could not remove entry', err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-3 font-serif text-lg font-semibold">Canon</h2>
        {status === 'loading' ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No canon yet. {isCreator ? 'Add the first character or rule below.' : 'Propose the first fact below.'}
          </p>
        ) : (
          <div className="space-y-4">
            {KINDS.map((kind) => {
              const rows = entries.filter((e) => e.data.kind === kind)
              if (rows.length === 0) return null
              return (
                <div key={kind}>
                  <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {CANON_KIND_LABELS[kind]}
                  </h3>
                  <ul className="space-y-2">
                    {rows.map((e) => (
                      <li key={e.recordId} className="group rounded-lg border border-border bg-card p-3 text-sm">
                        <div className="flex items-start gap-2">
                          <span className="font-medium">{e.data.name}</span>
                          {e.data.origin === 'proposal' && (
                            <Badge variant="outline" size="sm">
                              from proposal
                            </Badge>
                          )}
                          {isCreator && (
                            <button
                              type="button"
                              aria-label={`Remove ${e.data.name}`}
                              onClick={() => removeEntry(e.recordId, e.data.name)}
                              className="ml-auto text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          )}
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{e.data.content}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <ProposalQueue proposals={proposals} isCreator={isCreator} />

      <SignedInOnly label={isCreator ? 'edit the canon' : 'propose canon'}>
        {isCreator ? <AddEntryForm topicId={topicId} /> : <ProposeForm topicId={topicId} />}
      </SignedInOnly>
    </div>
  )
}

function ProposalQueue({
  proposals,
  isCreator,
}: {
  proposals: ReturnType<typeof useQuery<Proposal>>['records']
  isCreator: boolean
}) {
  const { userId } = useAuth()
  const { remove } = useMutations('canon_proposals')
  const { error, success } = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)

  if (proposals.length === 0) return null

  const review = async (proposalId: string, decision: 'approve' | 'reject') => {
    setBusyId(proposalId)
    try {
      await callAction('reviewProposal', { proposalId, decision })
      if (decision === 'approve') success('Added to canon')
    } catch (err) {
      error('Review failed', err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section>
      <h2 className="mb-1 font-serif text-lg font-semibold">
        Pending proposals <span className="text-sm font-normal text-muted-foreground">({proposals.length})</span>
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        {isCreator ? 'You created this topic, so you decide what becomes canon.' : 'The topic creator reviews these.'}
      </p>
      <ul className="space-y-2">
        {proposals.map((p) => (
          <li key={p.recordId} className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" size="sm">
                {p.data.kind}
              </Badge>
              <span className="font-medium">{p.data.name}</span>
              {p.data.source === 'ai' && (
                <Badge variant="info" size="sm">
                  <Sparkles className="size-3" /> AI
                </Badge>
              )}
            </div>
            <p className="mt-1 whitespace-pre-wrap">{p.data.content}</p>
            {p.data.reason && <p className="mt-1 text-xs italic text-muted-foreground">“{p.data.reason}”</p>}
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {p.data.source === 'ai' ? 'suggested for' : 'proposed by'} {p.data.proposerName || 'a writer'}
              </span>
              <div className="ml-auto flex gap-1.5">
                {isCreator ? (
                  <>
                    <Button size="sm" variant="outline" disabled={busyId === p.recordId} onClick={() => review(p.recordId, 'reject')}>
                      <X /> Reject
                    </Button>
                    <Button size="sm" loading={busyId === p.recordId} onClick={() => review(p.recordId, 'approve')}>
                      <Check /> Approve
                    </Button>
                  </>
                ) : (
                  p.data.proposedBy === userId && (
                    <Button size="sm" variant="ghost" onClick={() => remove(p.recordId)}>
                      Withdraw
                    </Button>
                  )
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function KindSelect({ value, onChange }: { value: CanonKind; onChange: (k: CanonKind) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as CanonKind)}
      className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
    >
      {KINDS.map((k) => (
        <option key={k} value={k}>
          {CANON_KIND_LABELS[k]}
        </option>
      ))}
    </select>
  )
}

function useEntryFields() {
  const [kind, setKind] = useState<CanonKind>('character')
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const reset = () => {
    setName('')
    setContent('')
  }
  return { kind, setKind, name, setName, content, setContent, reset, valid: !!name.trim() && !!content.trim() }
}

function EntryFields(f: ReturnType<typeof useEntryFields>) {
  return (
    <>
      <KindSelect value={f.kind} onChange={f.setKind} />
      <Input placeholder="Name — e.g. Wen Yan, The Salt Treaty" value={f.name} onChange={(e) => f.setName(e.target.value)} />
      <Textarea placeholder="The fact itself" rows={3} value={f.content} onChange={(e) => f.setContent(e.target.value)} />
    </>
  )
}

function AddEntryForm({ topicId }: { topicId: string }) {
  const f = useEntryFields()
  const [busy, setBusy] = useState(false)
  const { error } = useToast()
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await callAction('addCanonEntry', { topicId, kind: f.kind, name: f.name, content: f.content })
      f.reset()
    } catch (err) {
      error('Could not add entry', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border border-border p-3">
      <h3 className="text-sm font-medium">Add to canon</h3>
      <EntryFields {...f} />
      <Button type="submit" size="sm" loading={busy} disabled={!f.valid} className="w-full">
        Add entry
      </Button>
    </form>
  )
}

function ProposeForm({ topicId }: { topicId: string }) {
  const f = useEntryFields()
  const { create } = useMutations<Partial<Proposal>>('canon_proposals')
  const { user } = useAuthProfileReady({ requireUser: true })
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    void create({
      topicId,
      kind: f.kind,
      name: f.name.trim(),
      content: f.content.trim(),
      source: 'member',
      proposerName: user?.name ?? '',
    })
    f.reset()
  }
  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border border-border p-3">
      <h3 className="text-sm font-medium">Propose a canon fact</h3>
      <EntryFields {...f} />
      <Button type="submit" size="sm" disabled={!f.valid} className="w-full">
        Send to creator
      </Button>
    </form>
  )
}
