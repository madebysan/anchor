import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  BrainCircuit,
  ClipboardCheck,
  Download,
  FolderOpen,
  Github,
  History,
  Languages,
  ListChecks,
  MessageSquare,
  MessagesSquare,
  NotebookPen,
  Play,
  ShieldCheck,
  Terminal,
  TextCursorInput,
  Undo2,
  UserRoundCog,
} from "lucide-react";

import appIcon from "../../../assets/app-icon.png";
import appScreenshot from "../../../assets/screenshot.png";
import { Button } from "@/components/ui/button";

const releaseUrl = "https://github.com/madebysan/anchor/releases/latest";
const githubUrl = "https://github.com/madebysan/anchor";
const demoVideoUrl = "/anchor-demo.mp4";

const workflowItems = [
  {
    title: "1. Point to the sentence",
    description:
      "Select the line that needs help. The request stays with that passage, so the thread does not drift away from the work.",
  },
  {
    title: "2. Review the edit",
    description:
      "Claude suggests the change. Anchor applies it through the editor and keeps undo one click away.",
  },
] as const;

type PromptCardTone = "rewrite" | "whole" | "structure";

interface PromptCard {
  prompt: string;
  title: string;
  detail: string;
  tone: PromptCardTone;
  icon: LucideIcon;
}

const promptCards = [
  {
    prompt: "Tighten this paragraph. Keep the point.",
    title: "Rewrite one passage",
    detail: "Selection stays scoped",
    tone: "rewrite",
    icon: TextCursorInput,
  },
  {
    prompt: "Turn this note into next steps.",
    title: "Work from the whole note",
    detail: "Whole-note context",
    tone: "whole",
    icon: ListChecks,
  },
  {
    prompt: "Translate this section. Keep the headings.",
    title: "Keep structure intact",
    detail: "Shape stays intact",
    tone: "structure",
    icon: Languages,
  },
] satisfies readonly PromptCard[];

const useCaseItems = [
  {
    icon: NotebookPen,
    title: "Writers with messy drafts",
    description:
      "Keep notes, outlines, and edits in one file instead of moving between chat and editor.",
  },
  {
    icon: ClipboardCheck,
    title: "Product and design reviews",
    description:
      "Assign rewrite, critique, and follow-up tasks to the exact paragraph under review.",
  },
  {
    icon: BookOpen,
    title: "Researchers and students",
    description:
      "Ask for summaries, gaps, and next questions without losing where the thought came from.",
  },
  {
    icon: BrainCircuit,
    title: "Founders running on notes",
    description:
      "Turn rough notes into action items while keeping the original source visible.",
  },
] as const;

const detailItems = [
  {
    icon: FolderOpen,
    title: "Local markdown folders",
    description: "Open the notes folder you already use.",
  },
  {
    icon: Terminal,
    title: "Claude Code sessions",
    description: "Runs through your signed-in Claude Code install.",
  },
  {
    icon: MessageSquare,
    title: "Sidecar threads",
    description: "Threads sit next to each note.",
  },
  {
    icon: Undo2,
    title: "Undo stays visible",
    description: "Every applied edit has a revert path.",
  },
] as const;

const personaItems = [
  {
    icon: UserRoundCog,
    title: "Editor",
    description:
      "Give it your voice rules, banned words, and rewrite standards.",
  },
  {
    icon: ShieldCheck,
    title: "Reviewer",
    description:
      "Ask it to catch weak logic, missing context, and loose claims.",
  },
  {
    icon: MessagesSquare,
    title: "Research partner",
    description:
      "Point it at a passage and ask for questions, sources, or next steps.",
  },
  {
    icon: History,
    title: "Project memory",
    description:
      "Keep instructions tied to the folder so repeat work starts with context.",
  },
] as const;

export default function LandingPage() {
  const [isScreenshotLoaded, setIsScreenshotLoaded] = useState(false);
  const [isDemoVideoActive, setIsDemoVideoActive] = useState(false);
  const [isDemoVideoLoaded, setIsDemoVideoLoaded] = useState(false);
  const demoVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const previousTitle = document.title;
    const description = document.querySelector('meta[name="description"]');
    const previousDescription = description?.getAttribute("content");

    document.title = "Anchor - AI Writing Agents for Local Markdown";
    description?.setAttribute(
      "content",
      "Build your own team of AI writing agents for local markdown notes, with Claude Code working beside the file you keep.",
    );

    return () => {
      document.title = previousTitle;
      if (previousDescription !== null && previousDescription !== undefined) {
        description?.setAttribute("content", previousDescription);
      }
    };
  }, []);

  useEffect(() => {
    if (!isDemoVideoActive) return;

    const playDemoVideo = async () => {
      try {
        await demoVideoRef.current?.play();
      } catch (error) {
        console.warn("Anchor demo video could not autoplay after click:", error);
      }
    };

    void playDemoVideo();
  }, [isDemoVideoActive]);

  function handlePlayDemoVideo() {
    setIsDemoVideoActive(true);
  }

  return (
    <div className="anchor-landing min-h-screen overflow-x-hidden bg-[var(--landing-bg)] text-[var(--landing-ink)]">
      <div className="mx-auto min-h-screen max-w-[680px] border-r border-[var(--landing-line)] px-5 pt-10 sm:px-7 sm:pt-12">
        <header className="flex justify-center">
          <a
            href="#product"
            className="inline-flex size-[3.4375rem] items-center justify-center rounded-[1.35rem] bg-white/70 shadow-[0_10px_28px_var(--landing-card-shadow)] transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_40px_var(--landing-card-hover-shadow)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--landing-ink)]"
            aria-label="Anchor landing page"
          >
            <img
              src={appIcon}
              width={256}
              height={256}
              alt=""
              className="size-10 rounded-[0.9rem]"
            />
          </a>
        </header>

        <main id="product">
          <section className="pt-7 sm:pt-8">
            <p className="anchor-motion-in mb-4 font-mono text-xs font-bold uppercase tracking-[0.08em] text-[var(--landing-muted)]">
              Anchor / Local markdown + Claude Code
            </p>
            <h1 className="anchor-landing-display anchor-motion-in anchor-motion-delay-1 max-w-[660px] text-balance text-[clamp(2.85rem,5vw,3.65rem)] leading-[0.96]">
              Edit markdown with AI anchored to the words you mean.
            </h1>
            <p className="anchor-motion-in anchor-motion-delay-2 mt-4 max-w-[590px] text-pretty text-lg leading-8 text-[var(--landing-muted)]">
              Anchor opens your local notes folder. Select a sentence, ask
              Claude Code for a change, and review the edit right where you
              wrote it.
            </p>
            <div className="anchor-motion-in anchor-motion-delay-3 mt-5 flex flex-wrap gap-3">
              <Button
                asChild
                className="anchor-cta-button anchor-cta-button--primary h-auto rounded-full px-4 py-2.5 text-base font-bold"
              >
                <a href={releaseUrl}>
                  <span className="anchor-cta-icon">
                    <Download aria-hidden="true" className="size-4" />
                  </span>
                  <span className="flex flex-col items-start leading-none">
                    <span>Download for Mac</span>
                    <span className="mt-1 font-mono text-[0.68rem] font-normal uppercase tracking-[0.08em] opacity-70">
                      Latest release
                    </span>
                  </span>
                </a>
              </Button>
              <Button
                asChild
                variant="outline"
                className="anchor-cta-button anchor-cta-button--secondary h-auto rounded-full border-[var(--landing-line)] bg-white/55 px-4 py-2.5 text-base"
              >
                <a href={githubUrl}>
                  <span className="anchor-cta-icon">
                    <Github aria-hidden="true" className="size-4" />
                  </span>
                  <span className="flex flex-col items-start leading-none">
                    <span>View source</span>
                    <span className="mt-1 font-mono text-[0.68rem] font-normal uppercase tracking-[0.08em] opacity-65">
                      GitHub repo
                    </span>
                  </span>
                </a>
              </Button>
            </div>
          </section>

          <section
            aria-label="Anchor product demo"
            className="anchor-screenshot-frame relative my-6 w-full sm:my-8"
            data-loaded={isScreenshotLoaded || isDemoVideoLoaded}
            data-video-active={isDemoVideoActive}
          >
            <div className="absolute inset-0 -z-10 rounded-[1.5rem] bg-[radial-gradient(circle_at_20%_20%,var(--landing-warm-glow),transparent_32%),radial-gradient(circle_at_82%_60%,var(--landing-green-glow),transparent_30%)] blur-sm" />
            {isDemoVideoActive ? (
              <video
                ref={demoVideoRef}
                src={demoVideoUrl}
                controls
                playsInline
                preload="metadata"
                poster={appScreenshot}
                onLoadedData={() => setIsDemoVideoLoaded(true)}
                className="anchor-screenshot-image block aspect-[16/10] w-full rounded-[1.125rem] border border-[var(--landing-line)] bg-black object-contain shadow-[0_20px_60px_var(--landing-shadow)]"
              >
                <a href={demoVideoUrl}>Download the Anchor demo video</a>
              </video>
            ) : (
              <div className="relative">
                <img
                  src={appScreenshot}
                  width={2880}
                  height={1800}
                  fetchPriority="high"
                  alt="Anchor editor with a markdown note, document sidebar, and comments panel"
                  onLoad={() => setIsScreenshotLoaded(true)}
                  className="anchor-screenshot-image block w-full rounded-[1.125rem] border border-[var(--landing-line)] bg-white shadow-[0_20px_60px_var(--landing-shadow)]"
                />
                <button
                  type="button"
                  aria-label="Play Anchor demo video"
                  onClick={handlePlayDemoVideo}
                  className="anchor-play-button absolute left-1/2 top-[34%] inline-flex size-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/45 bg-black/82 text-white shadow-[0_20px_60px_var(--landing-shadow)] backdrop-blur-sm transition-[background-color,box-shadow,transform] duration-200 hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--landing-ink)] active:scale-[0.98]"
                >
                  <Play
                    aria-hidden="true"
                    className="ml-1 size-8 fill-current"
                  />
                </button>
              </div>
            )}
          </section>

          <section className="py-12">
            <h2 className="anchor-landing-display text-balance text-[clamp(2.25rem,5vw,3.25rem)] leading-none">
              Keep the document in charge.
            </h2>
            <div className="mt-7 grid gap-5 sm:grid-cols-2">
              {workflowItems.map((item) => (
                <article
                  key={item.title}
                  className="border-t border-[var(--landing-line)] pt-4"
                >
                  <h3 className="text-lg font-bold">{item.title}</h3>
                  <p className="mt-2 text-pretty leading-7 text-[var(--landing-muted)]">
                    {item.description}
                  </p>
                </article>
              ))}
            </div>

            <div
              className="anchor-note-card-stack"
              aria-label="Example Anchor requests"
            >
              {promptCards.map((card) => {
                const Icon = card.icon;
                return (
                  <article
                    key={card.title}
                    className={[
                      "anchor-note-card",
                      `anchor-note-card--${card.tone}`,
                    ].join(" ")}
                  >
                    <div className="anchor-note-card-shell">
                      <div
                        className="anchor-note-card-corners"
                        aria-hidden="true"
                      >
                        <span />
                        <span />
                      </div>

                      <div className="anchor-note-card-content">
                        <span
                          className={[
                            "anchor-note-card-badge",
                            `anchor-note-card-badge--${card.tone}`,
                          ].join(" ")}
                        >
                          <Icon aria-hidden="true" className="size-7" />
                        </span>

                        <div>
                          <p className="font-mono text-base leading-snug text-[var(--landing-muted)]">
                            "{card.prompt}"
                          </p>
                          <h3 className="mt-4 text-base font-bold">
                            {card.title}
                          </h3>
                          <p className="mt-1 font-mono text-xs leading-5 text-[var(--landing-muted)]">
                            {card.detail}
                          </p>
                        </div>
                      </div>

                      <div
                        className="anchor-note-card-corners"
                        aria-hidden="true"
                      >
                        <span />
                        <span />
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section
            id="local-first"
            className="border-t border-[var(--landing-line)] py-12"
          >
            <p className="font-mono text-xs font-bold uppercase tracking-[0.08em] text-[var(--landing-muted)]">
              Who it is for
            </p>
            <h2 className="anchor-landing-display mt-3 text-balance text-[clamp(2.25rem,5vw,3.25rem)] leading-none">
              For people who live in drafts, notes, and decisions.
            </h2>
            <p className="mt-4 max-w-[590px] text-pretty text-lg leading-8 text-[var(--landing-muted)]">
              Anchor is for work that already happens in markdown. Use it when
              the file matters, the edit needs context, and a generic chat
              window would lose the thread.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {useCaseItems.map((item) => {
                const Icon = item.icon;
                return (
                  <article
                    key={item.title}
                    className="anchor-use-card"
                  >
                    <span className="anchor-use-card-icon">
                      <Icon aria-hidden="true" className="size-4" />
                    </span>
                    <h3 className="mt-5 font-bold">{item.title}</h3>
                    <p className="mt-2 text-pretty leading-7 text-[var(--landing-muted)]">
                      {item.description}
                    </p>
                  </article>
                );
              })}
            </div>

            <div className="mt-7 grid border-t border-[var(--landing-line)] sm:grid-cols-2">
              {detailItems.map((item, index) => {
                const Icon = item.icon;
                const isLastItem = index === detailItems.length - 1;
                const isDesktopLastRow = index >= detailItems.length - 2;

                return (
                  <article
                    key={item.title}
                    className={[
                      "grid min-h-20 grid-cols-[2.25rem_1fr] gap-x-3 gap-y-2 border-[var(--landing-line)] px-1 py-4 sm:px-6 sm:py-5 sm:odd:border-r",
                      isLastItem ? "border-b-0" : "border-b",
                      isDesktopLastRow ? "sm:border-b-0" : "sm:border-b",
                    ].join(" ")}
                  >
                    <span className="inline-flex size-8 items-center justify-center rounded-full bg-[var(--landing-soft)]">
                      <Icon aria-hidden="true" className="size-4" />
                    </span>
                    <h3 className="min-w-0 self-center font-bold">
                      {item.title}
                    </h3>
                    <p className="col-start-2 font-mono text-sm leading-6 text-pretty text-[var(--landing-muted)]">
                      {item.description}
                    </p>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="border-t border-[var(--landing-line)] py-12">
            <p className="font-mono text-xs font-bold uppercase tracking-[0.08em] text-[var(--landing-muted)]">
              Personas
            </p>
            <h2 className="anchor-landing-display mt-3 text-balance text-[clamp(2.25rem,5vw,3.25rem)] leading-none">
              Build your own team of AI writing agents.
            </h2>
            <p className="mt-4 max-w-[590px] text-pretty text-lg leading-8 text-[var(--landing-muted)]">
              Anchor is not a blank LLM box. Create writer agents with their
              own instructions, context, and standards. Then assign comments
              and tasks to the right agent from the exact line you are working
              on.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {personaItems.map((item) => {
                const Icon = item.icon;
                return (
                  <article
                    key={item.title}
                    className="anchor-persona-card"
                  >
                    <div className="flex items-center gap-3">
                      <span className="anchor-persona-card-icon">
                        <Icon aria-hidden="true" className="size-4" />
                      </span>
                      <h3 className="font-bold">{item.title}</h3>
                    </div>
                    <p className="mt-4 text-pretty leading-7 text-[var(--landing-muted)]">
                      {item.description}
                    </p>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="border-t border-[var(--landing-line)] py-12 sm:py-16">
            <h2 className="anchor-landing-display max-w-[560px] text-balance text-[clamp(2.35rem,5vw,3.45rem)] leading-[0.96]">
              Keep the file. Ask Claude at the exact spot.
            </h2>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button
                asChild
                className="anchor-cta-button anchor-cta-button--primary h-auto rounded-full px-4 py-2.5 text-base font-bold"
              >
                <a href={releaseUrl}>
                  <span className="anchor-cta-icon">
                    <Download aria-hidden="true" className="size-4" />
                  </span>
                  <span className="flex flex-col items-start leading-none">
                    <span>Download for Mac</span>
                    <span className="mt-1 font-mono text-[0.68rem] font-normal uppercase tracking-[0.08em] opacity-70">
                      Latest release
                    </span>
                  </span>
                </a>
              </Button>
              <Button
                asChild
                variant="outline"
                className="anchor-cta-button anchor-cta-button--secondary h-auto rounded-full border-[var(--landing-line)] bg-white/55 px-4 py-2.5 text-base"
              >
                <a href={githubUrl}>
                  <span className="anchor-cta-icon">
                    <Github aria-hidden="true" className="size-4" />
                  </span>
                  <span className="flex flex-col items-start leading-none">
                    <span>View source</span>
                    <span className="mt-1 font-mono text-[0.68rem] font-normal uppercase tracking-[0.08em] opacity-65">
                      GitHub repo
                    </span>
                  </span>
                </a>
              </Button>
            </div>
          </section>
        </main>

        <footer className="flex flex-col gap-4 border-t border-[var(--landing-line)] py-8 text-sm text-[var(--landing-muted)] sm:flex-row sm:items-start sm:justify-between">
          <p>
            Made by{" "}
            <a
              href="https://santiagoalonso.com"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center hover:text-[var(--landing-ink)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--landing-ink)]"
            >
              santiagoalonso.com
            </a>
          </p>
          <div className="flex gap-4">
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center hover:text-[var(--landing-ink)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--landing-ink)]"
            >
              GitHub
            </a>
            <a
              href={releaseUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center hover:text-[var(--landing-ink)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--landing-ink)]"
            >
              Releases
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}
