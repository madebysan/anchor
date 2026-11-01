import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { FONTS, THEMES, mix, withContrast, type ThemePreset, type Variant } from '@/lib/appearance'
import { Bold, Check, Heading1, Heading2, Italic, List } from 'lucide-react'
import { Bar, Stage, useReducedMotion, Window, type Act } from './kit'
import './themes.css'

// Row 3: make it yours. Interactive.
//
// Plan: stacked cards (a setting over the detail it drives). On top, the
// Theme tiles of Anchor's Appearance settings, all eight, drawn as the app
// draws them ("Aa" in each theme's note font over its background, its
// accent as a short bar, the name under it), with Light and Dark beside
// the heading. Below, the note itself in the chosen theme, running off the
// bottom: the list in the interface font, the note in the editor font, its
// link in the accent. Click a tile or Light/Dark to try it; until you do,
// it moves through the themes on its own every few seconds, and stops for
// good at the first click. Reduced motion shows Clay, still.
//
// The colors are the app's: the presets and the mixing rules from
// src/lib/appearance.ts (every gray mixed from background and text, text
// and links pushed to 5:1 on the background), so what the tiles promise is
// what the note shows.

// Text and links reach 5:1 on the background, as in the app.
const readable = (color: string, background: string) => withContrast(color, background, 5)
const font = (id: string) => FONTS[id]?.stack ?? FONTS.geist.stack

function noteStyle(t: ThemePreset, v: Variant): CSSProperties {
  const p = t[v]
  const dark = v === 'dark'
  const text = readable(p.text, p.background)
  const tone = (a: number) => mix(text, p.background, a)
  return {
    '--th-bg': p.background,
    '--th-text': text,
    '--th-muted': readable(p.muted, p.background),
    '--th-body': readable(tone(0.88), p.background),
    '--th-link': readable(p.accent, p.background),
    '--th-fill': dark ? tone(0.1) : tone(0.06),
    '--th-line': dark ? tone(0.13) : tone(0.11),
    '--th-bar': dark ? tone(0.16) : tone(0.1),
    '--th-editor': font(t.fonts.editor),
    '--th-ui': font(t.fonts.ui),
  } as CSSProperties
}

// The tour it takes on its own: every theme once, light and dark taking turns
const TOUR: [string, Variant][] = [
  ['clay', 'light'],
  ['nord', 'dark'],
  ['paper', 'light'],
  ['catppuccin', 'dark'],
  ['sepia', 'light'],
  ['solarized', 'dark'],
  ['graphite', 'light'],
  ['anchor', 'dark'],
]
const STEP = 2600

// The scene is driven by the page's own state (clicks and the tour), not a
// script. A Stage with no script is a still and holds every transition, so
// it gets one that only keeps it live; reduced motion still shows a still.
const live = async (a: Act<Record<string, never>>) => {
  await a.wait(3_600_000)
}

function Note({ theme, variant, fresh, layout }: { theme: ThemePreset; variant: Variant; fresh: boolean; layout: 'wide' | 'compact' }) {
  const icon = { size: 13, strokeWidth: 1.8 }
  return (
    <div className="th-layer" data-fresh={fresh || undefined} style={noteStyle(theme, variant)} aria-hidden={!fresh}>
      <Window
        className="th-window"
        sidebarWidth={layout === 'compact' ? 122 : 134}
        sidebar={
          <div className="th-side">
            <span className="th-caps">Documents</span>
            <span className="th-row" data-on>
              Lisbon weekend.md
            </span>
            <span className="th-row">Packing list.md</span>
            <span className="th-row">
              <Bar w={44} h={5} className="th-bar" />
            </span>
          </div>
        }
        lead={
          <span className="th-tools">
            <Bold {...icon} />
            <Italic {...icon} />
            <Heading1 {...icon} />
            <Heading2 {...icon} />
            <List {...icon} />
          </span>
        }
      >
        <div className="th-page">
          <div className="th-title">Lisbon weekend</div>
          <p className="th-para">
            Two slow days: coffee in Príncipe Real, then the <span className="th-link">Miradouro</span> for sunset.
          </p>
          <span className="th-lines">
            <Bar w="92%" h={5} className="th-bar" />
            <Bar w="70%" h={5} className="th-bar" />
          </span>
        </div>
      </Window>
    </div>
  )
}

/** `onPick` hears only a visitor's own clicks, never the tour, so the page can follow them. */
export function Themes({ onPick }: { onPick?: (theme: ThemePreset, variant: Variant) => void } = {}) {
  const reduced = useReducedMotion()
  const [pick, setPick] = useState<{ id: string; variant: Variant }>({ id: 'clay', variant: 'light' })
  const [layers, setLayers] = useState<{ id: string; variant: Variant; key: number }[]>([{ id: 'clay', variant: 'light', key: 0 }])
  const [touched, setTouched] = useState(false)
  const [inView, setInView] = useState(false)
  const host = useRef<HTMLDivElement>(null)

  const choose = (id: string, variant: Variant) => {
    setPick({ id, variant })
    setLayers((ls) => {
      const top = ls[ls.length - 1]
      if (top.id === id && top.variant === variant) return ls
      // The new theme fades in over the one it replaces, which stays opaque
      // under it; the one below that is wholly covered, so it can go
      return [...ls.slice(-2), { id, variant, key: top.key + 1 }]
    })
  }

  useEffect(() => {
    const el = host.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.5 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // The tour runs only while the card is in view and until the first click
  useEffect(() => {
    if (reduced || touched || !inView) return
    let i = TOUR.findIndex(([id, v]) => id === pick.id && v === pick.variant)
    const t = window.setInterval(() => {
      i = (i + 1) % TOUR.length
      choose(TOUR[i][0], TOUR[i][1])
    }, STEP)
    return () => window.clearInterval(t)
  }, [reduced, touched, inView])

  const user = (id: string, variant: Variant) => {
    setTouched(true)
    choose(id, variant)
    onPick?.(byId(id), variant)
  }
  const byId = (id: string) => THEMES.find((t) => t.id === id)!
  const current = byId(pick.id)

  return (
    <div ref={host}>
      <Stage width={450} height={420} compact={{ below: 400, width: 342, height: 400 }} initial={{}} script={live} play="loop" className="anchor-look th">
        {(_s, _r, layout) => (
          <>
            <section className="th-card" aria-label="Theme">
              <div className="th-head">
                <span className="th-label">Theme</span>
                <span className="th-mode" role="radiogroup" aria-label="Mode">
                  <span className="th-thumb" data-dark={pick.variant === 'dark' || undefined} />
                  {(['light', 'dark'] as Variant[]).map((v) => (
                    <button key={v} type="button" role="radio" aria-checked={pick.variant === v} data-on={pick.variant === v || undefined} onClick={() => user(pick.id, v)}>
                      {v === 'light' ? 'Light' : 'Dark'}
                    </button>
                  ))}
                </span>
              </div>
              <div className="th-grid" role="radiogroup" aria-label="Theme">
                {THEMES.map((t) => {
                  const on = t.id === pick.id
                  const p = t[pick.variant]
                  return (
                    <button key={t.id} type="button" role="radio" aria-checked={on} className="th-tile" data-on={on || undefined} onClick={() => user(t.id, pick.variant)} title={t.name}>
                      <span className="th-swatch" style={{ background: p.background, color: p.text }}>
                        <span className="th-aa" style={{ fontFamily: font(t.fonts.editor) }}>
                          Aa
                        </span>
                        <span className="th-accent" style={{ background: p.accent }} />
                      </span>
                      <span className="th-name">
                        {t.name}
                        <Check size={12} strokeWidth={2.2} className="th-check" />
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
            <div className="th-note" data-layout={layout}>
              {layers.map((l, i) => (
                <Note key={l.key} theme={byId(l.id)} variant={l.variant} fresh={i === layers.length - 1} layout={layout} />
              ))}
            </div>
            <span className="th-live" aria-live="polite">
              {current.name}, {pick.variant}
            </span>
          </>
        )}
      </Stage>
    </div>
  )
}
