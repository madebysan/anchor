import { invoke } from "@tauri-apps/api/core";

export interface AiExecutionResult {
  success: boolean;
  output: string;
  error: string | null;
}

export interface AiSessionResult {
  success: boolean;
  output: string;
  error: string | null;
  /** claude session id captured from --output-format json. Reuse via --resume. */
  session_id: string | null;
}

export interface ClaudeStatus {
  installed: boolean;
  ready: boolean;
  detail: string | null;
  subscription_type: string | null;
}

export const CLAUDE_UNAVAILABLE_STATUS: ClaudeStatus = {
  installed: false,
  ready: false,
  detail: "Anchor could not check Claude Code.",
  subscription_type: null,
};

export async function checkClaudeStatus(): Promise<ClaudeStatus> {
  return invoke<ClaudeStatus>("ai_check_claude_status");
}

export async function checkClaudeCli(): Promise<boolean> {
  const status = await checkClaudeStatus();
  return status.ready;
}

export async function cancelClaude(requestId: string): Promise<boolean> {
  return invoke<boolean>("ai_cancel_claude", { requestId });
}

export async function chatClaude(
  prompt: string,
  requestId?: string,
): Promise<AiExecutionResult> {
  return invoke<AiExecutionResult>("ai_chat_claude", {
    prompt,
    requestId: requestId ?? null,
  });
}

// Session-aware claude call. Pass:
//   - filePath only (sessionId undefined) → start a fresh session reading that file
//   - sessionId only (filePath undefined) → resume an existing session
//   - neither → chat-only with no doc context
export async function invokeClaudeSession(args: {
  filePath?: string;
  sessionId?: string;
  prompt: string;
  requestId?: string;
}): Promise<AiSessionResult> {
  return invoke<AiSessionResult>("ai_invoke_claude", {
    filePath: args.filePath ?? null,
    sessionId: args.sessionId ?? null,
    prompt: args.prompt,
    requestId: args.requestId ?? null,
  });
}
