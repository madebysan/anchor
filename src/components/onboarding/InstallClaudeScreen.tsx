import { useState } from "react";
import { Button } from "@/components/ui/button";
import { checkClaudeCli } from "@/lib/ai-cli";

interface InstallClaudeScreenProps {
  onInstalled: () => void;
}

export default function InstallClaudeScreen({ onInstalled }: InstallClaudeScreenProps) {
  const [checking, setChecking] = useState(false);
  const [stillMissing, setStillMissing] = useState(false);

  async function recheck() {
    setChecking(true);
    setStillMissing(false);
    const ok = await checkClaudeCli();
    setChecking(false);
    if (ok) {
      onInstalled();
    } else {
      setStillMissing(true);
    }
  }

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-8 bg-background p-8 text-center">
      <div className="max-w-lg space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight">Install Claude Code</h1>
        <p className="text-base text-muted-foreground">
          Inline MD doesn't ship with its own AI. It uses your local{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">claude</code>{" "}
          CLI, which uses your Claude.ai subscription. No API keys, no per-token billing.
        </p>
        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-4 text-left text-sm">
          <p className="font-medium">Install steps:</p>
          <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>
              Visit{" "}
              <a
                href="https://claude.ai/code"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-foreground"
              >
                claude.ai/code
              </a>{" "}
              and follow the install instructions for your platform.
            </li>
            <li>
              Open a terminal and run{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono">claude login</code>.
            </li>
            <li>Click Recheck below.</li>
          </ol>
        </div>
      </div>
      <div className="flex flex-col items-center gap-3">
        <Button onClick={recheck} size="lg" disabled={checking}>
          {checking ? "Checking…" : "Recheck"}
        </Button>
        {stillMissing && (
          <p className="text-sm text-destructive">
            Still not finding <code className="font-mono">claude</code> on your PATH.
            Try opening a new terminal and re-running install, then click Recheck.
          </p>
        )}
      </div>
    </div>
  );
}
