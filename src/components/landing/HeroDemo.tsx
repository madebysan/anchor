import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown, Folder, FolderOpen, Loader2, SquarePen } from "lucide-react";
import { prefersReducedMotion, useOnScreen } from "./motion";

// The hero "video": the app window plays three short scenes in a loop, the
// way Anchor really behaves. Built in HTML so it stays sharp and light; it
// pauses off screen and shows a still frame for reduced motion.

type NoteVersion = "before" | "after" | "diagram";
type ToolState = "running" | "done";

interface Frame {
  ms: number;
  note: NoteVersion;
  /** The sentence that just changed is highlighted. */
  flash?: boolean;
  /** The passage is selected in the note. */
  selected?: boolean;
  /** The selection shown above the input. */
  quote?: string;
  input: string;
  sent?: { text: string; quote?: string };
  tools: { name: string; target: string; state: ToolState }[];
  reply?: string;
  folder?: boolean;
  renamed?: number;
}

const BEFORE = "Spend the afternoon at LX Factory, see the tile museum, and get to the Miradouro for sunset.";
const AFTER = "Spend a slow afternoon at LX Factory, then head up to the Miradouro for sunset. Leave the tile museum for next time.";
const NOTE_FILE = "Trips/Lisbon weekend.md";
const FILES = [
  { from: "Lisbon weekend.md", to: "2026-11 Lisbon weekend.md" },
  { from: "Packing list.md", to: "2026-11 Packing list.md" },
];

function typing(base: Omit<Frame, "ms" | "input">, text: string): Frame[] {
  const frames: Frame[] = [];
  for (let i = 1; i <= text.length; i++) frames.push({ ...base, input: text.slice(0, i), ms: 38 });
  return frames;
}

function buildScenes(): { label: string; summary: string; frames: Frame[] }[] {
  const rewriteAsk = "Make Saturday afternoon slower";
  const read = { name: "Read", target: NOTE_FILE };
  const edit = { name: "Edit", target: NOTE_FILE };
  const rewrite: Frame[] = [
    { ms: 900, note: "before", input: "", tools: [] },
    { ms: 700, note: "before", selected: true, input: "", tools: [] },
    { ms: 500, note: "before", selected: true, quote: BEFORE, input: "", tools: [] },
    ...typing({ note: "before", selected: true, quote: BEFORE, tools: [] }, rewriteAsk),
    { ms: 600, note: "before", selected: true, quote: BEFORE, input: rewriteAsk, tools: [] },
    { ms: 700, note: "before", input: "", sent: { text: rewriteAsk, quote: BEFORE }, tools: [{ ...read, state: "running" }] },
    { ms: 700, note: "before", input: "", sent: { text: rewriteAsk, quote: BEFORE }, tools: [{ ...read, state: "done" }, { ...edit, state: "running" }] },
    { ms: 900, note: "after", flash: true, input: "", sent: { text: rewriteAsk, quote: BEFORE }, tools: [{ ...read, state: "done" }, { ...edit, state: "done" }] },
    {
      ms: 3200,
      note: "after",
      flash: true,
      input: "",
      sent: { text: rewriteAsk, quote: BEFORE },
      tools: [{ ...read, state: "done" }, { ...edit, state: "done" }],
      reply: "I dropped the tile museum and kept LX Factory and the sunset, so the afternoon has room to wander.",
    },
  ];

  const diagramAsk = "Draw Saturday as a diagram";
  const diagram: Frame[] = [
    { ms: 800, note: "after", input: "", tools: [] },
    ...typing({ note: "after", tools: [] }, diagramAsk),
    { ms: 500, note: "after", input: diagramAsk, tools: [] },
    { ms: 900, note: "after", input: "", sent: { text: diagramAsk }, tools: [{ ...edit, state: "running" }] },
    { ms: 900, note: "diagram", flash: true, input: "", sent: { text: diagramAsk }, tools: [{ ...edit, state: "done" }] },
    {
      ms: 3200,
      note: "diagram",
      flash: true,
      input: "",
      sent: { text: diagramAsk },
      tools: [{ ...edit, state: "done" }],
      reply: "Added a diagram of the day under Saturday.",
    },
  ];

  const folderAsk = "Put the month in front of these names";
  const list = { name: "Read", target: "Trips/" };
  const move = { name: "Rename", target: "2 notes" };
  const folder: Frame[] = [
    { ms: 900, note: "diagram", folder: true, input: "", tools: [] },
    ...typing({ note: "diagram", folder: true, tools: [] }, folderAsk),
    { ms: 500, note: "diagram", folder: true, input: folderAsk, tools: [] },
    { ms: 800, note: "diagram", folder: true, input: "", sent: { text: folderAsk }, tools: [{ ...list, state: "running" }] },
    { ms: 600, note: "diagram", folder: true, input: "", sent: { text: folderAsk }, tools: [{ ...list, state: "done" }, { ...move, state: "running" }] },
    { ms: 500, note: "diagram", folder: true, renamed: 1, input: "", sent: { text: folderAsk }, tools: [{ ...list, state: "done" }, { ...move, state: "running" }] },
    { ms: 700, note: "diagram", folder: true, renamed: 2, input: "", sent: { text: folderAsk }, tools: [{ ...list, state: "done" }, { ...move, state: "done" }] },
    {
      ms: 3200,
      note: "diagram",
      folder: true,
      renamed: 2,
      input: "",
      sent: { text: folderAsk },
      tools: [{ ...list, state: "done" }, { ...move, state: "done" }],
      reply: "Renamed both notes in Trips to start with 2026-11.",
    },
  ];

  return [
    { label: "Rewrite a passage", summary: `You select a sentence and ask: ${rewriteAsk}. Claude rewrites it in place: ${AFTER}`, frames: rewrite },
    { label: "Add a diagram", summary: "You ask Claude to draw Saturday as a diagram, and it appears in the note.", frames: diagram },
    { label: "Work across a folder", summary: "With the Trips folder selected, you ask Claude to put the month in front of the note names, and both notes are renamed.", frames: folder },
  ];
}

export default function HeroDemo() {
  const scenes = useMemo(buildScenes, []);
  const reduced = useRef(prefersReducedMotion());
  const stageRef = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(stageRef);
  const [scene, setScene] = useState(0);
  const [frame, setFrame] = useState(() => (reduced.current ? scenes[0].frames.length - 1 : 0));
  const [announce, setAnnounce] = useState("");

  useEffect(() => {
    if (reduced.current || !onScreen) return;
    const frames = scenes[scene].frames;
    const timer = window.setTimeout(() => {
      if (frame + 1 < frames.length) setFrame(frame + 1);
      else {
        setScene((scene + 1) % scenes.length);
        setFrame(0);
      }
    }, frames[frame].ms);
    return () => window.clearTimeout(timer);
  }, [scene, frame, onScreen, scenes]);

  const pick = (index: number) => {
    setScene(index);
    setFrame(reduced.current ? scenes[index].frames.length - 1 : 0);
    setAnnounce(scenes[index].summary);
  };

  const f = scenes[scene].frames[frame];
  const total = scenes[scene].frames.reduce((sum, x) => sum + x.ms, 0);
  const elapsed = scenes[scene].frames.slice(0, frame).reduce((sum, x) => sum + x.ms, 0);
  // The bar runs to where this frame ends, over the frame's own duration.
  const progress = reduced.current ? 100 : ((elapsed + f.ms) / total) * 100;

  return (
    <div className="lp-demo" ref={stageRef}>
      <div className="lp-window" aria-hidden>
        <aside className="lp-w-side">
          <div className="lp-w-bar">
            <span className="lp-dots">
              <i />
              <i />
              <i />
            </span>
          </div>
          <div className="lp-w-label">Documents</div>
          <div className="lp-w-search">Search docs…</div>
          <div className={`lp-w-row ${f.folder ? "lp-w-active" : ""}`}>
            <ChevronDown size={13} /> <FolderOpen size={13} /> Trips
          </div>
          {FILES.map((file, i) => (
            <div
              key={file.from}
              className={`lp-w-row lp-w-file ${!f.folder && i === 0 ? "lp-w-active" : ""} ${(f.renamed ?? 0) > i ? "lp-renamed" : ""}`}
            >
              {(f.renamed ?? 0) > i ? file.to : file.from}
            </div>
          ))}
          <div className="lp-w-row">
            <ChevronDown size={13} className="lp-rot" /> <Folder size={13} /> Work
          </div>
          <div className="lp-w-row lp-w-root">Ideas.md</div>
          <div className="lp-w-row lp-w-root">Reading list.md</div>
        </aside>
        <div className="lp-w-note">
          <div className="lp-w-toolbar">
            <b>B</b>
            <i>I</i>
            <span>H1</span>
            <span>H2</span>
            <span className="lp-w-grow" />
            <span className="lp-w-saved">Saved</span>
          </div>
          <div className="lp-w-page">
            <h3>Lisbon weekend</h3>
            <p>Two slow days. One fixed plan each morning, the rest left open.</p>
            <h4>Saturday</h4>
            <p>
              Coffee in Príncipe Real, then walk down to the river.{" "}
              {f.note === "before" ? (
                <span className={f.selected ? "lp-sel" : ""}>{BEFORE}</span>
              ) : (
                <mark key={f.note === "after" && f.flash ? "flash" : "still"} className={f.note === "after" && f.flash ? "lp-flash" : "lp-plain"}>
                  {AFTER}
                </mark>
              )}
            </p>
            {f.note === "diagram" && (
              <div className={`lp-flow ${f.flash ? "lp-flash-block" : ""}`}>
                <span>Coffee</span>
                <ArrowRight size={14} />
                <span>The river</span>
                <ArrowRight size={14} />
                <span>LX Factory</span>
                <ArrowRight size={14} />
                <span>Sunset</span>
              </div>
            )}
            <h4>Sunday</h4>
            <ul>
              <li>Pastéis de nata in Belém before the queue</li>
              <li>Ferry to Cacilhas for lunch</li>
            </ul>
          </div>
        </div>
        <div className="lp-w-chat">
          <div className="lp-w-chathead">
            <span>{f.folder ? "Trips" : "Lisbon weekend.md"}</span>
            <SquarePen size={14} />
          </div>
          <div className="lp-w-thread">
            {f.sent && (
              <div className="lp-in">
                {f.sent.quote && (
                  <div className="lp-quote">
                    <small>Selection</small>
                    {f.sent.quote}
                  </div>
                )}
                <div className="lp-bubble">{f.sent.text}</div>
              </div>
            )}
            {f.tools.map((tool) => (
              <div key={tool.name} className="lp-step lp-in">
                {tool.state === "done" ? <Check size={12} /> : <Loader2 size={12} className="lp-spin" />} {tool.name}{" "}
                <code>{tool.target}</code>
              </div>
            ))}
            {f.reply && <p className="lp-reply lp-in">{f.reply}</p>}
          </div>
          <div className="lp-w-compose">
            {f.quote && (
              <div className="lp-quote lp-in">
                <small>1 line selected</small>
                {f.quote}
              </div>
            )}
            <div className={`lp-w-input ${f.input ? "lp-typing" : ""}`}>
              {f.input || "Message…"}
              {f.input && <span className="lp-caret" />}
            </div>
          </div>
        </div>
      </div>
      <div className="lp-tabs" role="tablist" aria-label="Demo scenes">
        {scenes.map((s, i) => (
          <button key={s.label} type="button" role="tab" aria-selected={i === scene} onClick={() => pick(i)}>
            <span className="lp-bar">
              <i
                key={i === scene ? `on-${scene}` : "off"}
                style={{
                  width: i === scene ? `${progress}%` : "0%",
                  transition: i === scene && !reduced.current ? `width ${f.ms}ms linear` : "none",
                }}
              />
            </span>
            {s.label}
          </button>
        ))}
      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}
