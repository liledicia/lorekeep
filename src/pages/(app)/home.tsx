/**
 * Topic directory — every public shared world, filterable by tag.
 */

import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthProfileReady, useMutations, useQuery } from 'deepspace'
import { BookOpen, Plus } from 'lucide-react'
import { Badge, Button, EmptyState, Input, Textarea, useToast } from '@/components/ui'
import { SignedInOnly } from '@/components/lore/SignInPrompt'
import { cleanName, normalizeTags, parseTags, timeAgo, type Topic } from '@/lib/lore'

export default function HomePage() {
  const { records, status } = useQuery<Topic>('topics', { orderBy: 'createdAt', orderDir: 'desc', limit: 200 })
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const allTags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of records) for (const t of parseTags(r.data.tags)) counts.set(t, (counts.get(t) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t)
  }, [records])

  const visible = activeTag ? records.filter((r) => parseTags(r.data.tags).includes(activeTag)) : records

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight">Shared worlds</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Each topic is one canon — characters, relationships, world rules — that many writers share.
            Write your own passages in it; the AI co-writer reads the canon before it writes.
          </p>
        </div>
        <SignedInOnly label="start a topic">
          <Button onClick={() => setCreating((v) => !v)}>
            <Plus /> New topic
          </Button>
        </SignedInOnly>
      </header>

      {creating && <NewTopicForm onDone={() => setCreating(false)} />}

      {allTags.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          <TagChip label="all" active={!activeTag} onClick={() => setActiveTag(null)} />
          {allTags.map((t) => (
            <TagChip key={t} label={t} active={activeTag === t} onClick={() => setActiveTag(t)} />
          ))}
        </div>
      )}

      {status === 'loading' ? (
        <p className="text-sm text-muted-foreground">Loading topics…</p>
      ) : visible.length === 0 ? (
        <EmptyState icon={<BookOpen />} title="No topics yet" description="Start the first shared world." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {visible.map((r) => (
            <li key={r.recordId}>
              <Link
                to={`/t/${r.recordId}`}
                className="block h-full rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/50"
              >
                <h2 className="font-serif text-lg font-semibold">{r.data.title}</h2>
                {r.data.premise && <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{r.data.premise}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {parseTags(r.data.tags).map((t) => (
                    <Badge key={t} variant="secondary" size="sm">
                      #{t}
                    </Badge>
                  ))}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {r.data.creatorName ? `by ${cleanName(r.data.creatorName)} · ` : ''}
                    {timeAgo(r.createdAt)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TagChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'rounded-full border px-3 py-1 text-xs transition-colors ' +
        (active ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:text-foreground')
      }
    >
      {label === 'all' ? 'All' : `#${label}`}
    </button>
  )
}

function NewTopicForm({ onDone }: { onDone: () => void }) {
  const { createConfirmed } = useMutations<Partial<Topic>>('topics')
  const { user } = useAuthProfileReady({ requireUser: true })
  const navigate = useNavigate()
  const { error } = useToast()
  const [title, setTitle] = useState('')
  const [premise, setPremise] = useState('')
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    try {
      const id = await createConfirmed({
        title: title.trim(),
        premise: premise.trim(),
        tags: normalizeTags(tags),
        creatorName: cleanName(user?.name),
      })
      onDone()
      navigate(`/t/${id}`)
    } catch (err) {
      error('Could not create topic', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mb-8 space-y-3 rounded-xl border border-border bg-card p-5">
      <Input placeholder="Topic title, e.g. “The Lighthouse Keepers”" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Textarea
        placeholder="Premise — the shared setup every writer starts from"
        value={premise}
        onChange={(e) => setPremise(e.target.value)}
        rows={3}
      />
      <Input placeholder="Tags, comma separated: slow-burn, fantasy, rivals" value={tags} onChange={(e) => setTags(e.target.value)} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={busy} disabled={!title.trim()}>
          Create topic
        </Button>
      </div>
    </form>
  )
}
