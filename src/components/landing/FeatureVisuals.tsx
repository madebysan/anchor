import { useRef, type ReactNode } from "react";
import { Check, FileText, Folder, Loader2 } from "lucide-react";
import { useLoop, useOnScreen } from "./motion";

// Small looping previews for the feature rows. Each plays only on screen and
// rests on its final step for reduced motion.

function Dots() {
  return (
    <span className="lp-dots" aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="lp-card">
      {title && (
        <div className="lp-card-head">
          <Dots />
          <span>{title}</span>
        </div>
      )}
      <div className="lp-card-body">{children}</div>
    </div>
  );
}

const CONVERSATIONS = [
  { name: "Lisbon weekend.md", folder: false, last: "Dropped the tile museum from Saturday." },
  { name: "Trips", folder: true, last: "Renamed both notes to start with 2026-11." },
  { name: "Launch plan.md", folder: false, last: "Moved the beta to ten people first." },
];

/** Notes and folders take turns: each conversation comes back, and Claude answers in it. */
export function ConversationsVisual() {
  const ref = useRef<HTMLDivElement>(null);
  const playing = useOnScreen(ref);
  // Per note: open (0), Claude writing (1), reply in (2).
  const step = useLoop([900, 1300, 1900, 900, 1300, 1900, 900, 1300, 1900], playing, 2);
  const active = Math.floor(step / 3);
  const phase = step % 3;
  return (
    <div ref={ref}>
      <Card title="Conversations">
        <div className="lp-list">
          {CONVERSATIONS.map((c, i) => (
            <div key={c.name} className={`lp-list-row ${i === active ? "lp-on" : ""}`}>
              <span className="lp-list-name">
                {c.folder ? <Folder size={13} /> : <FileText size={13} />} {c.name}
              </span>
              <small>
                {i === active && phase === 1 ? (
                  <span className="lp-writing" aria-hidden>
                    <i />
                    <i />
                    <i />
                  </span>
                ) : i !== active || phase === 2 ? (
                  <span key={i === active ? `in-${step}` : "rest"} className={i === active ? "lp-in" : ""}>
                    {c.last}
                  </span>
                ) : (
                  <span className="lp-faint">Open</span>
                )}
              </small>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/** Ask, the sentence is replaced in place and selected, then ⌘Z puts it back. */
export function EditsVisual() {
  const ref = useRef<HTMLDivElement>(null);
  const playing = useOnScreen(ref);
  // 0 note, 1 ask, 2 working, 3 replaced, 4 ⌘Z pressed, 5 restored
  const step = useLoop([1100, 1200, 900, 2600, 500, 1600], playing, 3);
  const replaced = step === 3 || step === 4;
  return (
    <div ref={ref} className="lp-edits">
      <Card title="Lisbon weekend.md">
        <p className="lp-serif">
          Coffee first, then the river.{" "}
          {replaced ? (
            <mark key="new" className="lp-flash">
              Spend a slow afternoon at LX Factory, then sunset at the Miradouro.
            </mark>
          ) : (
            <span key="old" className={step === 5 ? "lp-in" : ""}>
              See LX Factory, the tile museum and the Miradouro, all before sunset.
            </span>
          )}
        </p>
        <div className="lp-edits-foot">
          <div className={`lp-mini-chat ${step >= 1 && step <= 4 ? "lp-show" : ""}`}>
            <span className="lp-bubble">Make Saturday slower</span>
            {step === 2 ? (
              <span className="lp-step">
                <Loader2 size={12} className="lp-spin" /> Edit
              </span>
            ) : step >= 3 ? (
              <span className="lp-step">
                <Check size={12} /> Edit
              </span>
            ) : null}
          </div>
          <span className={`lp-keys ${step === 4 ? "lp-press" : ""} ${step >= 3 ? "lp-show" : ""}`}>
            <kbd>⌘</kbd>
            <kbd>Z</kbd>
          </span>
        </div>
      </Card>
    </div>
  );
}
