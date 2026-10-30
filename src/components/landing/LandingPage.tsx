import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Github } from "lucide-react";
import appIcon from "../../../assets/app-icon.png";
import HeroDemo from "./HeroDemo";
import { ConversationsVisual, EditsVisual } from "./FeatureVisuals";
import { useReveal } from "./motion";
import ThemeTiles from "./ThemeTiles";
import { previewStyle, tileKey, type ThemeTile } from "./themePreview";
import "./landing.css";
import "@fontsource/bricolage-grotesque/latin-700.css";

// The public page at anchor.santiagoalonso.com. Everything shown is our own UI,
// drawn in HTML with invented notes. There is no download yet, so both calls
// to action point to the GitHub repository.

const GITHUB_URL = "https://github.com/madebysan/anchor";
const PAGE_TITLE = "Anchor: a Markdown editor with Claude Code beside every note";
const PAGE_DESCRIPTION =
  "Anchor is a Markdown editor for Mac where every note and folder gets its own Claude Code conversation. Runs on your Claude subscription, no API key needed.";

/** Dark from 7 pm to 7 am on the visitor's clock. `?mode=dark|light` overrides it. */
function modeForNow(): "light" | "dark" {
  const forced = new URLSearchParams(window.location.search).get("mode");
  if (forced === "dark" || forced === "light") return forced;
  const hour = new Date().getHours();
  return hour >= 19 || hour < 7 ? "dark" : "light";
}

function useTimeOfDayMode() {
  const [mode, setMode] = useState(modeForNow);
  useEffect(() => {
    // Check again every minute, so a page left open turns over at 7.
    const timer = window.setInterval(() => setMode(modeForNow()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return mode;
}

function GitHubButton({ size }: { size: "sm" | "lg" }) {
  return (
    <a className={`lp-btn lp-btn-dark lp-btn-${size}`} href={GITHUB_URL}>
      <Github size={size === "lg" ? 18 : 16} aria-hidden /> View on GitHub
    </a>
  );
}

interface FeatureProps {
  title: string;
  children: ReactNode;
  visual: ReactNode;
  flip?: boolean;
  /** The visual has controls, so it stays in the accessibility tree. */
  interactive?: boolean;
}

function Feature({ title, children, visual, flip = false, interactive = false }: FeatureProps) {
  return (
    <section className={`lp-feature ${flip ? "lp-flip" : ""}`} data-reveal>
      <div className="lp-feature-visual" aria-hidden={interactive ? undefined : true}>
        {visual}
      </div>
      <div className="lp-feature-copy">
        <h2>{title}</h2>
        {children}
      </div>
    </section>
  );
}

/** The theme picked from the tiles, or null for the page's own look (Anchor). */
function useThemeChoice() {
  const [selected, setSelectedState] = useState<ThemeTile | null>(null);
  const selectedKey = selected ? tileKey(selected) : "";
  const gridRef = useRef<HTMLDivElement>(null);
  const anchorTop = useRef<number | null>(null);

  // New fonts change the height of everything above the tiles. Note where the
  // tiles were before the change, then scroll so they stay under the pointer.
  const setSelected = (tile: ThemeTile | null) => {
    anchorTop.current = gridRef.current?.getBoundingClientRect().top ?? null;
    setSelectedState(tile);
  };

  useLayoutEffect(() => {
    const before = anchorTop.current;
    if (before === null) return;
    const settle = () => {
      const now = gridRef.current?.getBoundingClientRect().top;
      if (now !== undefined && Math.abs(now - before) > 0.5) window.scrollBy({ top: now - before, behavior: "instant" });
    };
    settle();
    let cancelled = false;
    if (document.fonts?.status === "loading") document.fonts.ready.then(() => !cancelled && settle());
    return () => {
      cancelled = true;
    };
  }, [selectedKey]);

  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const root = document.querySelector<HTMLElement>(".lp");
    if (meta && root) meta.setAttribute("content", getComputedStyle(root).getPropertyValue("--lp-bg").trim());
  });

  return { selected, gridRef, setSelected, style: selected ? previewStyle(selected) : undefined };
}

/** Staggers the hero's entrance in reading order. */
const enter = (index: number) => ({ className: "lp-enter", style: { "--i": index } as CSSProperties });

export default function LandingPage() {
  const mode = useTimeOfDayMode();
  const rootRef = useRef<HTMLDivElement>(null);
  useReveal(rootRef);
  const theme = useThemeChoice();

  useEffect(() => {
    const previousTitle = document.title;
    const description = document.querySelector('meta[name="description"]');
    const previousDescription = description?.getAttribute("content");
    document.title = PAGE_TITLE;
    description?.setAttribute("content", PAGE_DESCRIPTION);
    return () => {
      document.title = previousTitle;
      if (previousDescription) description?.setAttribute("content", previousDescription);
    };
  }, []);

  return (
    <div ref={rootRef} className="lp" data-mode={theme.selected?.variant ?? mode} style={theme.style}>
      <header className="lp-nav">
        <a className="lp-brand" href="#top">
          <img src={appIcon} alt="" width={36} height={36} />
          Anchor
        </a>
        <GitHubButton size="sm" />
      </header>

      <main id="top">
        <section className="lp-hero">
          <p {...enter(0)} className="lp-pill lp-enter">
            <span>New</span> Your own AI co-editor, right in your Markdown files
          </p>
          <h1 {...enter(1)}>Your notes, with Claude beside them.</h1>
          <p {...enter(2)} className="lp-lede lp-enter">
            A Markdown editor for Mac where every note and folder gets its own Claude conversation. Runs on your Claude subscription, no API key needed.
          </p>
          <div {...enter(3)} className="lp-actions lp-enter">
            <GitHubButton size="lg" />
          </div>
        </section>

        <div {...enter(4)} className="lp-shot lp-enter">
          <HeroDemo />
        </div>

        <div className="lp-features">
          <Feature title="A conversation for every note and folder." visual={<ConversationsVisual />}>
            <p>Each note keeps its conversation, even after you quit. Select a folder and Claude works across every note in it.</p>
          </Feature>

          <Feature flip title="Edits land where you're writing." visual={<EditsVisual />}>
            <p>Claude replaces only the words that change, right in the note. Select a passage to send it along, and ⌘Z undoes any edit.</p>
          </Feature>

          <Feature
            title="Make it yours."
            interactive
            visual={<ThemeTiles gridRef={theme.gridRef} selected={theme.selected} onSelect={theme.setSelected} />}
          >
            <p>Eight themes in light and dark, each with its own fonts. Change any color and the text stays readable.</p>
          </Feature>
        </div>
      </main>

      <footer className="lp-footer">
        <span className="lp-brand">
          <img src={appIcon} alt="" width={26} height={26} />
          Anchor
        </span>
        <span>
          Made by <a href="https://santiagoalonso.com">santiagoalonso.com</a>
        </span>
      </footer>
    </div>
  );
}
