/**
 * Landing page — a STATIC, prerendered page (no auth, no realtime).
 * Keep it renderable without a browser: no window/document during render.
 */

import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { APP_NAME } from '../constants'
import { seo } from '../seo'

const STEPS = [
  ['One canon', 'A topic holds the shared truth: characters, relationships, world rules, timeline.'],
  ['Your own passages', 'Every writer writes their own passages. Others can read and comment, never edit.'],
  ['An AI that checks the canon', 'The co-writer looks up the canon before it writes, and suggests new facts for the creator to approve.'],
] as const

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="flex min-h-screen flex-col items-center justify-center px-6 py-16 text-center">
        <p className="mb-3 text-sm uppercase tracking-widest text-muted-foreground">{APP_NAME}</p>
        <h1 className="mb-4 max-w-2xl font-serif text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Write in a shared world without breaking its canon
        </h1>
        <p className="mb-10 max-w-lg text-muted-foreground">
          For niche fiction communities where everyone loves the same setup — and the AI keeps forgetting it.
        </p>
        <div className="mb-10 grid max-w-3xl gap-4 text-left sm:grid-cols-3">
          {STEPS.map(([title, body]) => (
            <div key={title} className="rounded-xl border border-border bg-card p-4">
              <h2 className="font-serif font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
        <Link
          to="/home"
          className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Browse shared worlds
        </Link>
      </div>
    </>
  )
}
