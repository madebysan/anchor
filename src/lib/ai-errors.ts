export interface AiErrorMessage {
  title: string;
  description: string;
  detail?: string;
  recovery?: string;
}

const AI_ERROR_PREFIX = "anchor-ai-error:";

function normalizeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function extractExitCode(raw: string): string | null {
  const match =
    raw.match(/exit status:\s*(\d+)/i) ??
    raw.match(/\bexited with code\s+(\d+)/i) ??
    raw.match(/\bstatus\s+(\d+)/i);
  return match?.[1] ?? null;
}

function describeAiError(rawInput: string): AiErrorMessage {
  const raw = rawInput.trim();
  const lower = raw.toLowerCase();

  if (lower.includes("failed to launch claude cli")) {
    return {
      title: "Claude Code could not start",
      description: "Anchor could not find or launch the Claude Code command.",
      detail: raw,
      recovery: "Open Terminal and run `claude` once, then try the request again here.",
    };
  }

  if (lower.includes("parse claude json")) {
    return {
      title: "Anchor could not read Claude's response",
      description: "Claude Code returned output, but it was not in the expected format.",
      detail: raw,
      recovery: "Retry the request. If it repeats, open Claude Code in Terminal and check for setup prompts.",
    };
  }

  if (lower.includes("reported is_error=true")) {
    return {
      title: "Claude Code reported an error",
      description: "Claude Code marked the request as failed without sending more detail.",
      recovery: "Retry once. If it repeats, open Claude Code in Terminal to see the full error.",
    };
  }

  if (
    lower.includes("claude exited with status") ||
    lower.includes("exit status:") ||
    lower.includes("exited with code")
  ) {
    const code = extractExitCode(raw);
    return {
      title: "Claude Code stopped before finishing",
      description: code
        ? `Claude Code exited with code ${code} before returning a response.`
        : "Claude Code exited before returning a response.",
      recovery: "Open Claude Code in Terminal to check login, model, or permission prompts, then retry here.",
    };
  }

  return {
    title: "AI request failed",
    description: raw || "Anchor did not receive a usable response.",
    recovery: "Retry the request. If it repeats, open Claude Code in Terminal to check the CLI.",
  };
}

export function createAiErrorMessage(error: unknown): string {
  return `${AI_ERROR_PREFIX}${JSON.stringify(
    describeAiError(normalizeUnknownError(error))
  )}`;
}

export function parseAiErrorMessage(content: string): AiErrorMessage | null {
  if (content.startsWith(AI_ERROR_PREFIX)) {
    try {
      const parsed: unknown = JSON.parse(content.slice(AI_ERROR_PREFIX.length));
      if (!isRecord(parsed)) return null;

      const title = getString(parsed.title);
      const description = getString(parsed.description);
      if (!title || !description) return null;

      return {
        title,
        description,
        detail: getString(parsed.detail),
        recovery: getString(parsed.recovery),
      };
    } catch {
      return null;
    }
  }

  if (content.startsWith("⚠️")) {
    return describeAiError(content.replace(/^⚠️\s*/, ""));
  }

  return null;
}
