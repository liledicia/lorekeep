# Lorekeep

**Shared-canon fiction with an AI co-writer that reads the canon before it writes.**

Live: **https://lorekeep.app.space** · Built on [DeepSpace](https://docs.deep.space) for the DeepSpace build exercise.

Niche fiction communities often share one setup — the same characters, the same world rules —
and each writer wants to write *their own* take inside it. General chat AIs are bad at this:
they forget the setting, contradict it, and you end up re-pasting a "lore doc" every session.

Lorekeep makes the setting a first-class, permissioned data set:

1. **A topic is one canon** — characters, relationships, world rules, timeline.
   Only the topic's creator decides what is canon.
2. **Everyone writes their own passages.** Other writers can read (live, as you type)
   and comment on a quoted line, but they can never edit your passage.
3. **The AI co-writer looks things up instead of being fed a prompt dump.** It gets a
   few topic-bound tools (`read_canon`, `list_passages`, `read_passage`) and calls them
   before continuing your draft. A second mode checks your passage against the canon and
   files **proposals** for new facts — which still need the creator's approval.

## The core flow

| Step | Who | What happens |
| --- | --- | --- |
| Create a topic, add canon | creator | Canon writes go through a server action that checks *caller = topic creator* |
| Start a passage, write | any member | Autosaves; readers see it update in real time |
| **Continue** | passage author | AI calls `read_canon` (+ other passages if needed), streams ~300 words in the draft's language |
| **Check against canon** | passage author | AI compares the passage with canon, calls `propose_canon` for new durable facts, summarises contradictions |
| Approve / reject proposals | creator | Approval copies the proposal into canon (server action, re-checks the creator) |
| Comment on a line | any member | Select text → comment with quote; appears live for everyone |

## DeepSpace pieces used (and why)

| Primitive | Where | Why it's here |
| --- | --- | --- |
| **Auth** + roles | everywhere | Signed-out visitors can read (`'*'`/`viewer` read-only); members write |
| **Records + realtime sync** | all five collections | Passages update live for readers; comments and AI proposals appear without refresh |
| **Row-level permissions** (`'own'`, `userBound`, `immutable`, `writableFields`) | `src/schemas/lore-schemas.ts` | "Others can read, only the author can edit" is enforced by the record room, not by hiding buttons |
| **Server actions** | `src/actions/index.ts` | Canon has *no* client write path. Add / delete / approve are actions that load the topic and compare `creatorId` to the verified caller |
| **AI (DeepSpace agent proxy) + tool use over records** | `src/server/lore-ai.ts` | The model reads canon through tools that run **as the calling user** (`createUserToolExecutor`), so it can only see/do what that user can |

**Left out on purpose:** payments (nothing to sell), file uploads (text-only product),
messaging channels (passage comments cover the need), Yjs co-editing (a passage has exactly
one author by design), cron/background jobs (every AI action is user-initiated and streams in
seconds). Each would add surface without making the core loop better.

## Data model & permissions

| Collection | Read | Create | Update / delete |
| --- | --- | --- | --- |
| `topics` | everyone | members | creator only (`'own'` on `creatorId`) |
| `canon_entries` | everyone | **nobody from the client** — server actions only | server actions only |
| `canon_proposals` | everyone | members (AI proposals are created *as the user*) | status changes via action only; proposer may withdraw |
| `passages` | everyone | members | author only (`'own'` on `authorId`) |
| `comments` | everyone | members | author only |

Author/creator columns are `userBound` + `immutable`, so a client cannot claim to be someone else.
`writableFields` keeps clients from setting `status` on a proposal or `origin` on canon.

## AI design notes

- **Tools, not prompt stuffing.** Canon is fetched by the model via tools bound to the passage's
  topic (the topicId comes from the stored passage, never from the request body).
- **Same permissions as the user.** Tools run through `createUserToolExecutor`; the AI cannot write
  canon because the user can't either — it can only *propose*.
- **Author-only + developer-billed.** AI calls are billed to the app owner so reviewers without
  credits can try it; to bound cost, only a passage's author can run the AI on it, and drafts are capped.
- **Streams plain text** to the editor; the author chooses Insert / Try again / Discard.
- Language follows the draft (tested with Chinese).

## Known limitations / next steps

- **Display names are denormalised** onto records at write time (members can't read the `users`
  table). A writer could set a misleading display name; next step is a server action that stamps it.
- **No rate limit** on AI routes beyond "author only". Next: per-user daily quota in a small collection.
- **Private topics + invite links** (planned with `'team'` permissions + `team_members`) — not built.
- **Proposal de-duplication**: the AI may re-propose something already pending.
- **Presence** ("who's reading now") was cut for time.

## Run locally

```sh
npm install
npx deepspace auth login
npx deepspace dev start      # local worker + vite
npx deepspace deploy         # ship to lorekeep.app.space
```

## Where things live

```
src/schemas/lore-schemas.ts        collections + permissions (start here)
src/actions/index.ts               creator-checked canon actions
src/server/lore-ai.ts              AI routes: tools, prompts, streaming
src/lib/lore.ts                    client types + fetch helpers
src/components/lore/CanonPanel.tsx canon sidebar, proposal review
src/pages/(app)/home.tsx           topic directory
src/pages/(app)/t/[topicId]/...    topic page, passage editor/reader
```
