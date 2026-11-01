import { Bold, EllipsisVertical, Heading1, Heading2, Italic, List, Send, Square } from 'lucide-react'
import { Bar, Collapse, Roll, Stage, Window, type Act } from './kit'
import './edit.css'

// Row 2: edits land where you're writing.
//
// Plan: the note is the hero, a window a gutter from the top and left that
// runs off the right; its words stay a gutter clear of the stage edge and
// only the empty page bleeds. The satellite is the bottom of Anchor's
// conversation panel (its composer), straddling the window's bottom edge on
// the right, where the chat lives in the app, over the note's lower filler.
// One story, four beats:
//   1. The writer drag-selects a sentence; it shows as a quote in the
//      composer ("Selection · 1 line"), as Anchor does.
//   2. They type "Make Saturday slower" and send it; Claude works.
//   3. Payoff: only the changed words roll out and the new ones roll in,
//      in place, flashed green and left selected (so the composer quotes
//      the new words). The rest of the sentence never moves.
//   4. A click puts the caret back, then ⌘Z: the words roll back. That
//      undo is the loop's reset, and the scene is back at its first frame.
//
// Real strings: the note's title and heading, the one paragraph, the quote
// and the typed request. Everything else is bars.

const PRE = 'Coffee in Príncipe Real, then down to the river. '
const S1 = 'LX Factory after lunch, then '
const OLD = 'the tile museum and'
const NEW = 'a slow walk up to'
// The changed run ends its line, so a change in its width never reflows
// the words after it
const S2 = 'the Miradouro for sunset.'
const PARA = PRE + S1 + OLD + S2
const START = PRE.length
const END = PARA.length
const ASK = 'Make Saturday slower'

type Sel = 'none' | 'drag' | 'sentence' | 'changed'
type S = {
  /** How far the drag has selected, in characters of PARA */
  to: number
  sel: Sel
  draft: string
  focus: boolean
  busy: boolean
  edited: boolean
  flash: boolean
  /** The poster's still: the flash held at its brightest */
  hold?: boolean
}

const initial: S = { to: START, sel: 'none', draft: '', focus: false, busy: false, edited: false, flash: false }
const poster: S = { to: END, sel: 'changed', draft: '', focus: false, busy: false, edited: true, flash: false, hold: true }

const REST = { wide: { x: 340, y: 116 }, compact: { x: 290, y: 108 } }

async function script(a: Act<S>) {
  await a.wait(1100)

  // 1. Select the sentence, left to right, under the I-beam
  const s0 = a.rect('sent-start')
  const e0 = a.rect('sent-end')
  await a.move({ x: s0.x + 1, y: s0.y + s0.height / 2 })
  await a.wait(220)
  a.put({ sel: 'drag' })
  await a.drag({ x: e0.x + 1, y: e0.y + e0.height / 2 }, (at) => a.put({ to: Math.max(START, a.caret('para', at)) }), { duration: 1400 })
  a.put({ to: END, sel: 'sentence' })
  await a.wait(700)

  // 2. Ask, in the composer the selection went to
  await a.move({ at: 'input', x: 0.55, y: 0.5 })
  await a.wait(120)
  await a.click()
  await a.set({ focus: true })
  await a.wait(250)
  await a.type('draft', ASK, { interval: 48 })
  await a.wait(350)
  await a.move({ at: 'send', x: 0.5, y: 0.55 })
  await a.wait(120)
  a.mark('send')
  await a.click()
  await a.set({ draft: '', busy: true, sel: 'none', focus: false })
  await a.move('rest-edit')
  await a.wait(1500)

  // 3. The edit lands in place, selected
  a.mark('edit')
  await a.set({ busy: false, edited: true, flash: true, sel: 'changed' })
  await a.wait(3200)

  // 4. Back in the note: a click, then ⌘Z rolls the words back
  const end = a.rect('sent-end')
  await a.move({ x: Math.min(end.x + 34, a.layout === 'compact' ? 318 : 410), y: end.y + end.height / 2 })
  await a.wait(120)
  await a.click()
  await a.set({ sel: 'none', flash: false })
  await a.wait(450)
  a.mark('undo')
  await a.key('cmd+z')
  await a.set({ edited: false, to: START })
  await a.wait(1100)
  await a.move(REST[a.layout])
  await a.wait(900)
}

function Toolbar() {
  const icon = { size: 15, strokeWidth: 1.7 }
  return (
    <span className="ed-tools" aria-hidden>
      <Bold {...icon} />
      <Italic {...icon} />
      <Heading1 {...icon} />
      <Heading2 {...icon} />
      <List {...icon} />
      <EllipsisVertical {...icon} />
    </span>
  )
}

// One structure for every beat, so nothing remounts mid-story: the drag
// paints each run up to the caret, and the changed run is the Roll.
function Paragraph({ s }: { s: S }) {
  const dragging = s.sel === 'drag'
  const whole = s.sel === 'sentence' || undefined
  const painting = dragging || s.sel === 'sentence'
  const upTo = (from: number, text: string) => Math.max(0, Math.min(text.length, s.to - from))
  const a = START
  const b = START + S1.length
  const c = b + OLD.length
  // The painted part stays mounted and only fades, so a selection never
  // blinks out: it clears the way the editor's own does
  const run = (from: number, text: string) => {
    const n = upTo(from, text)
    return (
      <>
        <span className="ed-sel" data-on={(painting && n > 0) || undefined}>
          {text.slice(0, n)}
        </span>
        {text.slice(n)}
      </>
    )
  }
  // Inside the rolling run the drag paints a share of its width, by characters
  const share = dragging ? upTo(b, OLD) / OLD.length : 0
  return (
    <p className="ed-para" data-target="para" data-cursor="ibeam">
      {PRE}
      <span data-target="sent-start" className="ed-anchor" />
      <span className="ed-run">{run(a, S1)}</span>
      <span
        className="ed-changed"
        data-sel={whole || s.sel === 'changed' || undefined}
        data-flash={s.flash || undefined}
        data-hold={s.hold || undefined}
        style={dragging && share > 0 ? { backgroundImage: `linear-gradient(to right, var(--an-select) ${share * 100}%, transparent ${share * 100}%)` } : undefined}
      >
        <Roll stagger={70}>{s.edited ? NEW : OLD}</Roll>
      </span>
      <br />
      <span className="ed-run">{run(c, S2)}</span>
      <span data-target="sent-end" className="ed-anchor" />
    </p>
  )
}

function Quote({ text }: { text: string }) {
  return (
    <div className="ed-quote">
      <span className="ed-quote-label">Selection · 1 line</span>
      <span className="ed-quote-text">{text}</span>
    </div>
  )
}

function Composer({ s }: { s: S }) {
  return (
    <div className="ed-composer">
      <Collapse open={s.busy} reveal="drop">
        <div className="ed-busy">
          <span className="ed-dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span className="ed-stop">
            <Square size={10} strokeWidth={2} />
            Stop
          </span>
        </div>
      </Collapse>
      {/* Two quotes, each always holding its own words, so each opens at
          its own height: the selected sentence, then the changed words
          Claude leaves selected */}
      <Collapse open={s.sel === 'sentence'} reveal="drop">
        <Quote text={`${S1}${OLD} ${S2}`} />
      </Collapse>
      <Collapse open={s.sel === 'changed'} reveal="drop">
        <Quote text={NEW} />
      </Collapse>
      <div className="ed-input-row">
        <div className="ed-input" data-target="input" data-cursor="ibeam" data-focus={s.focus || undefined}>
          {s.draft ? (
            <span className="ed-typed" data-typing>
              {s.draft}
            </span>
          ) : (
            <span className="ed-placeholder">Message…</span>
          )}
          {s.focus && <span className="ed-caret" data-snap />}
        </div>
        <span className="ed-send" data-target="send" data-on={s.draft ? true : undefined}>
          <Send size={14} strokeWidth={1.8} />
        </span>
      </div>
    </div>
  )
}

export function EditInPlace() {
  return (
    <Stage<S>
      width={450}
      height={420}
      compact={{ below: 400, width: 342, height: 388 }}
      initial={initial}
      poster={poster}
      script={script}
      cursor={{ at: REST }}
      keys={{ wide: "bottom-left", compact: "top" }}
      className="anchor-look ed"
    >
      {(s) => (
        <>
          <Window className="ed-window" lead={<Toolbar />}>
            <div className="ed-page" data-crop>
              <div className="ed-title">Lisbon weekend</div>
              <div className="ed-h2">Saturday</div>
              <Paragraph s={s} />
              <Bar w={78} h={9} r={3} tone={4} className="ed-h2-bar" />
              <div className="ed-bullets">
                {[188, 150, 172].map((w, i) => (
                  <span key={i} className="ed-bullet">
                    <Bar w={5} h={5} r={3} tone={3} />
                    <Bar w={w} h={6} tone={2} />
                  </span>
                ))}
              </div>
            </div>
          </Window>
          <span className="ed-rest" data-target="rest-edit" />
          <Composer s={s} />
        </>
      )}
    </Stage>
  )
}
