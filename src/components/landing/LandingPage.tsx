import { useEffect, useState } from "react";
import {
  Code2,
  Download,
  FileText,
  Github,
  MessageSquare,
  Undo2,
} from "lucide-react";

import appIcon from "../../../assets/app-icon.png";
import appScreenshot from "../../../assets/screenshot.png";
import { Button } from "@/components/ui/button";

const releaseUrl = "https://github.com/madebysan/anchor/releases/latest";
const githubUrl = "https://github.com/madebysan/anchor";

const navItems = [
  { label: "Product", href: "#product" },
  { label: "Privacy", href: "#local-first" },
  { label: "Download", href: releaseUrl },
] as const;

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

const promptCards = [
  {
    prompt: "Tighten this paragraph. Keep the point.",
    title: "Rewrite one passage",
  },
  {
    prompt: "Turn this note into next steps.",
    title: "Work from the whole note",
  },
  {
    prompt: "Translate this section. Keep the headings.",
    title: "Keep structure intact",
  },
] as const;

const localFirstItems = [
  {
    icon: FileText,
    title: "Plain markdown",
    description: "Open the folder you already use.",
  },
  {
    icon: Code2,
    title: "Claude Code only",
    description: "Uses your signed-in Claude Code install.",
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

export default function LandingPage() {
  const [isScreenshotLoaded, setIsScreenshotLoaded] = useState(false);

  useEffect(() => {
    const previousTitle = document.title;
    const description = document.querySelector('meta[name="description"]');
    const previousDescription = description?.getAttribute("content");

    document.title = "Anchor - Claude Code edits for local markdown";
    description?.setAttribute(
      "content",
      "Anchor opens local markdown folders and lets you ask Claude Code for edits on selected passages.",
    );

    return () => {
      document.title = previousTitle;
      if (previousDescription !== null && previousDescription !== undefined) {
        description?.setAttribute("content", previousDescription);
      }
    };
  }, []);

  return (
    <div className="anchor-landing min-h-screen overflow-x-hidden bg-[var(--landing-bg)] text-[var(--landing-ink)]">
      <div className="mx-auto min-h-screen max-w-[680px] border-r border-[var(--landing-line)] px-5 pt-12 sm:px-7 sm:pt-14">
        <header className="flex items-center justify-between gap-5">
          <a
            href="#product"
            className="inline-flex items-center gap-3 rounded-xl text-base font-bold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--landing-ink)]"
            aria-label="Anchor landing page"
          >
            <img
              src={appIcon}
              width={256}
              height={256}
              alt=""
              className="size-8 rounded-xl"
            />
            <span className="hidden sm:inline">Anchor</span>
          </a>

          <nav
            aria-label="Landing page navigation"
            className="flex rounded-full bg-[var(--landing-soft)] p-1 text-sm"
          >
            {navItems.map((item, index) => (
              <a
                key={item.label}
                href={item.href}
                className={[
                  "rounded-full px-3 py-2 leading-none text-[var(--landing-ink)] transition-colors hover:bg-[var(--landing-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--landing-ink)]",
                  index === 0 ? "bg-[var(--landing-ink)] text-white hover:bg-[var(--landing-ink)]" : "",
                ].join(" ")}
              >
                {item.label}
              </a>
            ))}
          </nav>
        </header>

        <main id="product">
          <section className="pt-10 sm:pt-12">
            <p className="anchor-motion-in mb-4 font-mono text-xs font-bold uppercase tracking-[0.08em] text-[var(--landing-muted)]">
              Anchor / Local markdown + Claude Code
            </p>
            <h1 className="anchor-landing-display anchor-motion-in anchor-motion-delay-1 max-w-[660px] text-balance text-[clamp(3rem,6vw,4.35rem)] leading-[0.96]">
              Edit markdown with AI anchored to the words you mean.
            </h1>
            <p className="anchor-motion-in anchor-motion-delay-2 mt-5 max-w-[590px] text-pretty text-lg leading-8 text-[var(--landing-muted)]">
              Anchor opens your local notes folder. Select a sentence, ask
              Claude Code for a change, and review the edit right where you
              wrote it.
            </p>
            <div className="anchor-motion-in anchor-motion-delay-3 mt-6 flex flex-wrap gap-3">
              <Button
                asChild
                className="h-11 rounded-full px-5 text-base font-bold"
              >
                <a href={releaseUrl}>
                  <Download aria-hidden="true" />
                  Download Anchor
                </a>
              </Button>
              <Button
                asChild
                variant="outline"
                className="h-11 rounded-full border-[var(--landing-line)] bg-white/50 px-5 text-base"
              >
                <a href={githubUrl}>
                  <Github aria-hidden="true" />
                  View GitHub
                </a>
              </Button>
            </div>
          </section>

          <section
            aria-label="Anchor product screenshot"
            className="anchor-screenshot-frame relative my-10 w-full sm:my-12"
            data-loaded={isScreenshotLoaded}
          >
            <div className="absolute inset-0 -z-10 rounded-[1.5rem] bg-[radial-gradient(circle_at_20%_20%,var(--landing-warm-glow),transparent_32%),radial-gradient(circle_at_82%_60%,var(--landing-green-glow),transparent_30%)] blur-sm" />
            <img
              src={appScreenshot}
              width={2880}
              height={1800}
              fetchPriority="high"
              alt="Anchor editor with a markdown note, document sidebar, and comments panel"
              onLoad={() => setIsScreenshotLoaded(true)}
              className="anchor-screenshot-image block w-full rounded-[1.125rem] border border-[var(--landing-line)] bg-white shadow-[0_20px_60px_var(--landing-shadow)]"
            />
          </section>

          <section className="border-t border-[var(--landing-line)] py-12">
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

            <div className="relative mt-9 min-h-[320px] sm:min-h-[300px]">
              {promptCards.map((card, index) => (
                <article
                  key={card.title}
                  className={[
                    "rounded-2xl border border-[var(--landing-line)] bg-white p-5 shadow-[0_16px_45px_var(--landing-card-shadow)] transition-transform duration-200 hover:-translate-y-1",
                    "sm:absolute sm:min-h-[230px] sm:w-[250px]",
                    index === 0 ? "sm:left-0 sm:top-6 sm:-rotate-2" : "",
                    index === 1 ? "mt-4 sm:left-[150px] sm:top-0 sm:z-10 sm:mt-0" : "",
                    index === 2 ? "mt-4 sm:right-0 sm:top-10 sm:rotate-2 sm:mt-0" : "",
                  ].join(" ")}
                >
                  <p className="font-mono text-sm leading-6 text-[var(--landing-ink)]">
                    "{card.prompt}"
                  </p>
                  <h3 className="mt-8 text-lg font-bold">{card.title}</h3>
                </article>
              ))}
            </div>
          </section>

          <section
            id="local-first"
            className="border-t border-[var(--landing-line)] py-12"
          >
            <h2 className="anchor-landing-display text-balance text-[clamp(2.25rem,5vw,3.25rem)] leading-none">
              Local notes, no hosted workspace.
            </h2>
            <div className="mt-7 grid border-t border-[var(--landing-line)] sm:grid-cols-2">
              {localFirstItems.map((item) => {
                const Icon = item.icon;
                return (
                  <article
                    key={item.title}
                    className="min-h-24 border-b border-[var(--landing-line)] py-5 sm:pr-5 sm:even:pl-5 sm:odd:border-r"
                  >
                    <div className="mb-3 flex items-center gap-3">
                      <span className="inline-flex size-8 items-center justify-center rounded-full bg-[var(--landing-soft)]">
                        <Icon aria-hidden="true" className="size-4" />
                      </span>
                      <h3 className="font-bold">{item.title}</h3>
                    </div>
                    <p className="font-mono text-sm leading-6 text-[var(--landing-muted)]">
                      {item.description}
                    </p>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="border-t border-[var(--landing-line)] py-12 sm:py-16">
            <h2 className="anchor-landing-display max-w-[620px] text-balance text-[clamp(3.2rem,8vw,5.5rem)] leading-[0.93]">
              Keep the file. Ask Claude at the exact spot.
            </h2>
            <Button
              asChild
              className="mt-7 h-11 rounded-full px-5 text-base font-bold"
            >
              <a href={releaseUrl}>
                <Download aria-hidden="true" />
                Download Anchor
              </a>
            </Button>
          </section>
        </main>

        <footer className="flex flex-col gap-4 border-t border-[var(--landing-line)] py-8 text-sm text-[var(--landing-muted)] sm:flex-row sm:items-start sm:justify-between">
          <p>Made by santiagoalonso.com</p>
          <div className="flex gap-4">
            <a
              href={githubUrl}
              className="hover:text-[var(--landing-ink)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--landing-ink)]"
            >
              GitHub
            </a>
            <a
              href={releaseUrl}
              className="hover:text-[var(--landing-ink)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--landing-ink)]"
            >
              Releases
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}
