/**
 * A single passage.
 *
 * - The author gets an editor that autosaves, plus the AI co-writer
 *   ("Continue" streams prose that reads the canon first; "Suggest canon"
 *   files proposals for the topic creator).
 * - Everyone else reads it — the text updates live as the author saves — and
 *   can leave comments, optionally quoting a line.
 * - Editing someone else's passage is refused by the record room's 'own'
 *   rule, not just by this UI.
 */

import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth, useAuthProfileReady, useMutations, useQuery } from 'deepspace'
import { ArrowLeft, Check, Quote, RotateCcw, Sparkles, Trash2, Wand2, X } from 'lucide-react'
import { Badge, Button, EmptyState, Input, Textarea, useToast } from '@/components/ui'
import { CanonPanel } from '@/components/lore/CanonPanel'
import { SignedInOnly } from '@/components/lore/SignInPrompt'
import { cleanName, countWords, streamAi, timeAgo, type Comment, type Passage, type Topic } from '@/lib/lore'

export default function PassagePage() {
  const { topicId = '', passageId = '' } = useParams()
  const { userId } = useAuth()
  const { records: topics } = useQuery<Topic>('topics', { limit: 500 })
  const topic = topics.find((t) => t.recordId === topicId)
  const { records: passages, status } = useQuery<Passage>('passages', { where: { topicId }, limit: 300 })
  const passage = passages.find((p) => p.recordId === passageId)
  const [quote, setQuote] = useState('')

  if (status === 'loading') return <p className="p-10 text-sm text-muted-foreground">Loading…</p>
  if (!passage) {
    return (
      <div className="p-10">
        <EmptyState title="Passage not found" description="It may have been deleted by its author." />
      </div>
    )
  }

  const isAuthor = !!userId && passage.data.authorId === userId
  const isCreator = !!userId && topic?.data.creatorId === userId

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Link to={`/t/${topicId}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {topic?.data.title ?? 'Back to topic'}
      </Link>

      <div className="grid gap-10 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-10">
          {isAuthor ? (
            <AuthorEditor passageId={passageId} passage={passage.data} />
          ) : (
            <Reader passage={passage.data} updatedAt={passage.updatedAt} onQuote={setQuote} />
          )}
          <Comments topicId={topicId} passageId={passageId} quote={quote} setQuote={setQuote} />
        </div>
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <CanonPanel topicId={topicId} isCreator={isCreator} />
        </aside>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

function Reader({ passage, updatedAt, onQuote }: { passage: Passage; updatedAt: string; onQuote: (q: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [selection, setSelection] = useState('')

  const captureSelection = () => {
    const sel = window.getSelection()
    const text = sel?.toString().trim() ?? ''
    if (text && ref.current && sel?.anchorNode && ref.current.contains(sel.anchorNode)) setSelection(text.slice(0, 300))
    else setSelection('')
  }

  return (
    <article>
      <h1 className="font-serif text-3xl font-semibold tracking-tight">{passage.title}</h1>
      <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
        by {cleanName(passage.authorName) || 'a writer'} · updated {timeAgo(updatedAt)}
        <Badge variant="outline" size="sm">
          live
        </Badge>
      </p>
      <div
        ref={ref}
        onMouseUp={captureSelection}
        className="mt-6 whitespace-pre-wrap font-serif text-[17px] leading-8 text-foreground"
      >
        {passage.body?.trim() ? passage.body : <span className="text-muted-foreground">The author hasn’t written anything yet.</span>}
      </div>
      {selection && (
        <Button
          size="sm"
          variant="outline"
          className="mt-3"
          onClick={() => {
            onQuote(selection)
            setSelection('')
            document.getElementById('comment-box')?.focus()
          }}
        >
          <Quote /> Comment on this line
        </Button>
      )}
    </article>
  )
}

// ---------------------------------------------------------------------------
// Author editor + AI co-writer
// ---------------------------------------------------------------------------

function AuthorEditor({ passageId, passage }: { passageId: string; passage: Passage }) {
  const { put } = useMutations<Partial<Passage>>('passages')
  const { error, success } = useToast()
  const [title, setTitle] = useState(passage.title)
  const [body, setBody] = useState(passage.body ?? '')
  const [saved, setSaved] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced autosave. Each save syncs live to readers through the record room.
  const schedule = (next: { title?: string; body?: string }) => {
    setSaved(false)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void put(passageId, next).then(() => setSaved(true))
    }, 700)
  }
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  // --- AI: continue -------------------------------------------------------
  const [instruction, setInstruction] = useState('')
  const [aiText, setAiText] = useState('')
  const [aiBusy, setAiBusy] = useState<null | 'continue' | 'suggest'>(null)
  const [suggestSummary, setSuggestSummary] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const runContinue = async () => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setAiText('')
    setAiBusy('continue')
    try {
      await streamAi('/api/lore/continue', { passageId, draft: body, instruction }, (chunk) => setAiText((t) => t + chunk), ac.signal)
    } catch (err) {
      if (!ac.signal.aborted) error('AI co-writer failed', err instanceof Error ? err.message : String(err))
    } finally {
      setAiBusy(null)
    }
  }

  const insertAi = () => {
    const sep = body.trim() ? (body.endsWith('\n') ? '\n' : '\n\n') : ''
    const next = body + sep + aiText.trim()
    setBody(next)
    schedule({ title, body: next })
    setAiText('')
  }

  // --- AI: suggest canon --------------------------------------------------
  const runSuggest = async () => {
    setSuggestSummary('')
    setAiBusy('suggest')
    try {
      await streamAi('/api/lore/suggest-canon', { passageId, draft: body }, (chunk) => setSuggestSummary((t) => t + chunk))
      success('Canon check finished', 'Any proposals are in the sidebar, waiting for the topic creator.')
    } catch (err) {
      error('Canon check failed', err instanceof Error ? err.message : String(err))
    } finally {
      setAiBusy(null)
    }
  }

  const words = countWords(body)

  return (
    <section>
      <Input
        value={title}
        onChange={(e) => {
          setTitle(e.target.value)
          schedule({ title: e.target.value, body })
        }}
        className="h-auto border-none px-0 font-serif text-3xl font-semibold shadow-none focus-visible:ring-0"
        aria-label="Passage title"
      />
      <p className="mb-3 text-xs text-muted-foreground">
        Your passage · {words} words · {saved ? 'saved' : 'saving…'} · other writers can read and comment, but only you can edit
      </p>
      <Textarea
        value={body}
        onChange={(e) => {
          setBody(e.target.value)
          schedule({ title, body: e.target.value })
        }}
        rows={16}
        placeholder="Start writing… The AI co-writer can pick up from wherever you stop."
        className="font-serif text-[17px] leading-8"
      />

      {(aiText || aiBusy === 'continue') && (
        <div className="mt-3 rounded-xl border border-primary/40 bg-primary/5 p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-primary">
            <Sparkles className="size-3.5" /> AI continuation {aiBusy === 'continue' && '— reading the canon and writing…'}
          </div>
          <p className="whitespace-pre-wrap font-serif text-[17px] leading-8">{aiText || '…'}</p>
          {aiBusy !== 'continue' && aiText && (
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={insertAi}>
                <Check /> Insert
              </Button>
              <Button size="sm" variant="outline" onClick={runContinue}>
                <RotateCcw /> Try again
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAiText('')}>
                <X /> Discard
              </Button>
            </div>
          )}
          {aiBusy === 'continue' && (
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => abortRef.current?.abort()}>
              Stop
            </Button>
          )}
        </div>
      )}

      <div className="mt-4 rounded-xl border border-border bg-card p-4">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-medium">
          <Wand2 className="size-4" /> AI co-writer
        </h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="Optional direction: “she finally says it out loud”, “slow down, more dialogue”"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
          />
          <Button onClick={runContinue} loading={aiBusy === 'continue'} disabled={!!aiBusy}>
            <Sparkles /> Continue
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button variant="outline" size="sm" onClick={runSuggest} loading={aiBusy === 'suggest'} disabled={!!aiBusy || words < 10}>
            Check against canon & suggest new facts
          </Button>
          <span className="text-xs text-muted-foreground">Suggestions go to the topic creator for approval.</span>
        </div>
        {suggestSummary && <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{suggestSummary}</p>}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Comments (realtime)
// ---------------------------------------------------------------------------

function Comments({
  topicId,
  passageId,
  quote,
  setQuote,
}: {
  topicId: string
  passageId: string
  quote: string
  setQuote: (q: string) => void
}) {
  const { userId } = useAuth()
  const { user } = useAuthProfileReady({ requireUser: true })
  const { records } = useQuery<Comment>('comments', { where: { passageId }, orderBy: 'createdAt', orderDir: 'asc', limit: 300 })
  const { create, remove } = useMutations<Partial<Comment>>('comments')
  const [text, setText] = useState('')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    void create({ topicId, passageId, body: text.trim(), quote: quote || undefined, authorName: cleanName(user?.name) })
    setText('')
    setQuote('')
  }

  return (
    <section>
      <h2 className="mb-3 font-serif text-xl font-semibold">
        Comments <span className="text-sm font-normal text-muted-foreground">({records.length})</span>
      </h2>
      <ul className="space-y-3">
        {records.map((c) => (
          <li key={c.recordId} className="group rounded-lg border border-border bg-card p-3 text-sm">
            {c.data.quote && (
              <blockquote className="mb-2 border-l-2 border-primary/50 pl-2 font-serif italic text-muted-foreground">
                {c.data.quote}
              </blockquote>
            )}
            <p className="whitespace-pre-wrap">{c.data.body}</p>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              {cleanName(c.data.authorName) || 'a writer'} · {timeAgo(c.createdAt)}
              {c.data.authorId === userId && (
                <button
                  type="button"
                  aria-label="Delete comment"
                  onClick={() => remove(c.recordId)}
                  className="ml-auto opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-4">
        <SignedInOnly label="comment">
          <form onSubmit={submit} className="space-y-2">
            {quote && (
              <div className="flex items-start gap-2 rounded-md bg-muted p-2 text-xs">
                <Quote className="mt-0.5 size-3 shrink-0" />
                <span className="font-serif italic">{quote}</span>
                <button type="button" className="ml-auto" aria-label="Remove quote" onClick={() => setQuote('')}>
                  <X className="size-3" />
                </button>
              </div>
            )}
            <Textarea id="comment-box" rows={2} placeholder="Leave a note for the author…" value={text} onChange={(e) => setText(e.target.value)} />
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={!text.trim()}>
                Comment
              </Button>
            </div>
          </form>
        </SignedInOnly>
      </div>
    </section>
  )
}
