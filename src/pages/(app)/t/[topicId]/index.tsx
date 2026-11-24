/**
 * One shared world: premise, everyone's passages, and the canon sidebar.
 */

import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth, useAuthProfileReady, useMutations, useQuery } from 'deepspace'
import { ArrowLeft, Feather, PenLine } from 'lucide-react'
import { Badge, Button, EmptyState, Input, useToast } from '@/components/ui'
import { CanonPanel } from '@/components/lore/CanonPanel'
import { SignedInOnly } from '@/components/lore/SignInPrompt'
import { parseTags, timeAgo, type Passage, type Topic } from '@/lib/lore'

export default function TopicPage() {
  const { topicId = '' } = useParams()
  const { userId } = useAuth()
  const { records: topics, status } = useQuery<Topic>('topics', { limit: 500 })
  const topic = topics.find((t) => t.recordId === topicId)
  const { records: passages } = useQuery<Passage>('passages', {
    where: { topicId },
    orderBy: 'updatedAt',
    orderDir: 'desc',
    limit: 200,
  })

  if (status === 'loading') return <p className="p-10 text-sm text-muted-foreground">Loading…</p>
  if (!topic) {
    return (
      <div className="p-10">
        <EmptyState title="Topic not found" description="It may have been deleted." />
      </div>
    )
  }

  const isCreator = !!userId && topic.data.creatorId === userId
  const mine = passages.filter((p) => p.data.authorId === userId)
  const others = passages.filter((p) => p.data.authorId !== userId)

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Link to="/home" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All topics
      </Link>
      <header className="mb-8">
        <h1 className="font-serif text-3xl font-semibold tracking-tight">{topic.data.title}</h1>
        {topic.data.premise && <p className="mt-2 max-w-3xl whitespace-pre-wrap text-muted-foreground">{topic.data.premise}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {parseTags(topic.data.tags).map((t) => (
            <Badge key={t} variant="secondary" size="sm">
              #{t}
            </Badge>
          ))}
          <span className="text-xs text-muted-foreground">
            created by {topic.data.creatorName || 'a writer'}
            {isCreator && ' (you)'}
          </span>
        </div>
      </header>

      <div className="grid gap-10 lg:grid-cols-[1fr_360px]">
        <div className="space-y-8">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-serif text-xl font-semibold">Passages</h2>
            <SignedInOnly label="write">
              <NewPassageButton topicId={topicId} />
            </SignedInOnly>
          </div>

          {passages.length === 0 ? (
            <EmptyState icon={<Feather />} title="No passages yet" description="Be the first to write in this world." />
          ) : (
            <>
              {mine.length > 0 && <PassageList title="Yours" topicId={topicId} rows={mine} />}
              {others.length > 0 && <PassageList title="By other writers" topicId={topicId} rows={others} />}
            </>
          )}
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <CanonPanel topicId={topicId} isCreator={isCreator} />
        </aside>
      </div>
    </div>
  )
}

function PassageList({
  title,
  topicId,
  rows,
}: {
  title: string
  topicId: string
  rows: ReturnType<typeof useQuery<Passage>>['records']
}) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {rows.map((p) => (
          <li key={p.recordId}>
            <Link to={`/t/${topicId}/p/${p.recordId}`} className="block p-4 hover:bg-accent/40">
              <div className="flex items-baseline gap-2">
                <span className="font-serif font-medium">{p.data.title}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {p.data.authorName || 'a writer'} · {timeAgo(p.updatedAt)}
                </span>
              </div>
              {p.data.body && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{p.data.body}</p>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function NewPassageButton({ topicId }: { topicId: string }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const { createConfirmed } = useMutations<Partial<Passage>>('passages')
  const { user } = useAuthProfileReady({ requireUser: true })
  const navigate = useNavigate()
  const { error } = useToast()

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <PenLine /> New passage
      </Button>
    )
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const id = await createConfirmed({ topicId, title: title.trim(), body: '', authorName: user?.name ?? '' })
      navigate(`/t/${topicId}/p/${id}`)
    } catch (err) {
      error('Could not create passage', err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="flex gap-2">
      <Input autoFocus placeholder="Passage title" value={title} onChange={(e) => setTitle(e.target.value)} className="w-56" />
      <Button type="submit" loading={busy} disabled={!title.trim()}>
        Start
      </Button>
    </form>
  )
}
