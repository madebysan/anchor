import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  CLAUDE_UNAVAILABLE_STATUS,
  checkClaudeStatus,
  type ClaudeStatus,
} from "@/lib/ai-cli";

interface InstallClaudeScreenProps {
  status: ClaudeStatus;
  onStatusChange: (status: ClaudeStatus) => void;
}

export default function InstallClaudeScreen({
  status,
  onStatusChange,
}: InstallClaudeScreenProps) {
  const [checking, setChecking] = useState(false);
  const isInstalled = status.installed;

  async function recheck() {
    setChecking(true);
    try {
      const nextStatus = await checkClaudeStatus();
      onStatusChange(nextStatus);
    } catch (e) {
      console.error("checkClaudeStatus failed:", e);
      onStatusChange(CLAUDE_UNAVAILABLE_STATUS);
    } finally {
      setChecking(false);
    }
  }

  return (
    <main className="flex h-screen w-screen flex-col items-center justify-center gap-8 bg-background p-8 text-center">
      <div className="max-w-lg space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight">
          {isInstalled ? "Finish Claude Code Setup" : "Install Claude Code"}
        </h1>
        <p className="text-base text-muted-foreground">
          Anchor uses your local{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">claude</code>{" "}
          CLI with your signed-in Claude.ai account. No API keys, no per-token billing.
        </p>
        {status.detail && (
          <p className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
            {status.detail}
          </p>
        )}
        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-4 text-left text-sm">
          <p className="font-medium">{isInstalled ? "Setup steps:" : "Install steps:"}</p>
          <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
            {!isInstalled && (
              <li>
                Visit{" "}
                <a
                  href="https://claude.ai/code"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center align-middle underline hover:text-foreground"
                >
                  claude.ai/code
                </a>{" "}
                and follow the install instructions for your platform.
              </li>
            )}
            <li>
              Open a terminal and run{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono">claude login</code>.
            </li>
            <li>Click Recheck below.</li>
          </ol>
        </div>
      </div>
      <div className="flex flex-col items-center gap-3">
        <Button onClick={recheck} size="lg" disabled={checking} className="min-h-11">
          {checking ? "Checking…" : "Recheck"}
        </Button>
      </div>
    </main>
  );
}
