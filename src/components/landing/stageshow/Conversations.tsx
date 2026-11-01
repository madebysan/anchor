import { Check, ChevronDown, ChevronRight, FileText, Folder, FolderOpen, FolderPlus, Plus, Search, SquarePen } from 'lucide-react'
import { Bar, Roll, Stage, States, Window, type Act } from './kit'
import './conversations.css'

// Row 1: a conversation for every note and folder.
//
// Plan: a feature card (pinned, bottom bleed) holding Anchor's window cut to
// the two panes the story needs: the document list and the conversation
// beside it. The editor between them is left out at this size; the window
// keeps its real chrome, its list and its chat. The cursor clicks Packing
// list, then the Trips folder, then Lisbon weekend again: each time the
// conversation pane swaps to that note's or folder's own session, and the
// first one is back exactly as it was left. The loop ends where it began.
//
// Real strings: the three tree items the cursor touches, the pane heading,
// and one short exchange per session. Everything else is quiet.

type Target = 'lisbon' | 'packing' | 'trips'
type S = { sel: Target }

const initial: S = { sel: 'lisbon' }

const NAMES: Record<Target, string> = { lisbon: 'Lisbon weekend', packing: 'Packing list', trips: 'Trips' }

type Session = { ask: string; steps: [string, string][]; reply: string; earlier: [number, number, number] }
const SESSIONS: Record<Target, Session> = {
  lisbon: {
    ask: 'Make Saturday slower',
    steps: [
      ['Read', 'Trips/Lisbon weekend.md'],
      ['Edit', 'Trips/Lisbon weekend.md'],
    ],
    reply: 'I dropped the tile museum and kept LX Factory and the sunset, so the afternoon has room to wander.',
    earlier: [118, 176, 132],
  },
  packing: {
    ask: 'What am I forgetting?',
    steps: [
      ['Read', 'Trips/Packing list.md'],
      ['Edit', 'Trips/Packing list.md'],
    ],
    reply: 'A phone charger and the ferry tickets for Cacilhas. Both are on the list now.',
    earlier: [92, 168, 110],
  },
  trips: {
    ask: 'Summarize this folder',
    steps: [
      ['Read', 'Trips/Lisbon weekend.md'],
      ['Read', 'Trips/Packing list.md'],
    ],
    reply: 'Two notes for one weekend: the Lisbon plan, day by day, and what to pack for it.',
    earlier: [134, 160, 96],
  },
}

const REST = { wide: { x: 168, y: 318 }, compact: { x: 120, y: 290 } }

async function script(a: Act<S>) {
  await a.wait(1500)
  for (const [target, x] of [
    ['packing', 0.7],
    ['trips', 0.74],
    ['lisbon', 0.82],
  ] as const) {
    await a.move({ at: `row-${target}`, x, y: 0.62 })
    await a.wait(180)
    await a.click()
    await a.set({ sel: target })
    await a.wait(target === 'lisbon' ? 700 : 2900)
  }
  await a.move(REST[a.layout])
  await a.wait(900)
}

function Tree({ sel }: S) {
  return (
    <div className="cv-side">
      <div className="cv-side-head">
        <span className="cv-caps">Documents</span>
        <span className="cv-side-tools">
          <FolderPlus size={13} strokeWidth={1.6} />
          <Plus size={13} strokeWidth={1.6} />
        </span>
      </div>
      <div className="cv-search">
        <Search size={11} strokeWidth={1.8} />
        <span>Search docs…</span>
      </div>
      <div className="cv-tree">
        <div className="cv-item cv-folder" data-target="row-trips" data-on={sel === 'trips' || undefined}>
          <ChevronDown size={12} strokeWidth={1.8} className="cv-chev" />
          <FolderOpen size={13} strokeWidth={1.6} className="cv-ficon" />
          <span className="cv-name">Trips</span>
        </div>
        <div className="cv-item cv-file" data-target="row-lisbon" data-on={sel === 'lisbon' || undefined}>
          <span className="cv-name">Lisbon weekend.md</span>
        </div>
        <div className="cv-item cv-file" data-target="row-packing" data-on={sel === 'packing' || undefined}>
          <span className="cv-name">Packing list.md</span>
        </div>
        <div className="cv-item cv-folder">
          <ChevronRight size={12} strokeWidth={1.8} className="cv-chev" />
          <Folder size={13} strokeWidth={1.6} className="cv-ficon" />
          <span className="cv-name">Work</span>
        </div>
        <div className="cv-item cv-top">
          <Bar w={46} h={6} tone={3} />
        </div>
        <div className="cv-item cv-top">
          <Bar w={70} h={6} tone={3} />
        </div>
        <div className="cv-item cv-top">
          <Bar w={54} h={6} tone={3} />
        </div>
      </div>
    </div>
  )
}

function Conversation({ session, on }: { session: Session; on: boolean }) {
  return (
    <div className="cv-convo" data-on={on || undefined} aria-hidden={!on}>
      {/* The session's earlier turn, quiet: this is where it was left off */}
      <div className="cv-earlier" aria-hidden>
        <span className="cv-ask cv-ask--quiet">
          <Bar w={session.earlier[0]} h={6} tone={3} />
        </span>
        <Bar w={session.earlier[1]} h={6} tone={2} />
        <Bar w={session.earlier[2]} h={6} tone={2} />
      </div>
      <div className="cv-ask">{session.ask}</div>
      <div className="cv-steps">
        {session.steps.map(([verb, path], i) => (
          <div key={i} className="cv-step">
            <Check size={12} strokeWidth={2.2} className="cv-tick" />
            <span className="cv-verb">{verb}</span>
            <span className="cv-path">{path}</span>
          </div>
        ))}
      </div>
      <div className="cv-reply">{session.reply}</div>
    </div>
  )
}

export function Conversations() {
  return (
    <Stage<S>
      width={450}
      height={350}
      compact={{ below: 400, width: 342, height: 316 }}
      initial={initial}
      poster={initial}
      script={script}
      cursor={{ at: REST }}
      className="anchor-look cv"
    >
      {(s, _rect, layout) => (
        <Window
          className="cv-window"
          sidebar={<Tree {...s} />}
          sidebarWidth={layout === 'compact' ? 136 : 160}
          lead={
            <span className="cv-heading">
              <span className="cv-heading-icon">
                <States value={s.sel === 'trips' ? 'folder' : 'note'} states={{ note: <FileText size={14} strokeWidth={1.7} />, folder: <Folder size={14} strokeWidth={1.7} /> }} />
              </span>
              <Roll variant="fade" className="cv-heading-name">
                {NAMES[s.sel]}
              </Roll>
            </span>
          }
          toolbar={<SquarePen size={14} strokeWidth={1.6} className="cv-new" />}
        >
          <div className="cv-body" data-crop>
            {(Object.keys(SESSIONS) as Target[]).map((t) => (
              <Conversation key={t} session={SESSIONS[t]} on={s.sel === t} />
            ))}
          </div>
        </Window>
      )}
    </Stage>
  )
}
