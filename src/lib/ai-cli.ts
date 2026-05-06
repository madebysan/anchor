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

export async function checkClaudeCli(): Promise<boolean> {
  return invoke<boolean>("ai_check_claude_cli");
}

export async function chatClaude(prompt: string): Promise<AiExecutionResult> {
  return invoke<AiExecutionResult>("ai_chat_claude", { prompt });
}

// Session-aware claude call. Pass:
//   - filePath only (sessionId undefined) → start a fresh session reading that file
//   - sessionId only (filePath undefined) → resume an existing session
//   - neither → chat-only with no doc context
export async function invokeClaudeSession(args: {
  filePath?: string;
  sessionId?: string;
  prompt: string;
}): Promise<AiSessionResult> {
  return invoke<AiSessionResult>("ai_invoke_claude", {
    filePath: args.filePath ?? null,
    sessionId: args.sessionId ?? null,
    prompt: args.prompt,
  });
}

export async function executeClaudeEdit(
  filePath: string,
  prompt: string,
): Promise<AiExecutionResult> {
  return invoke<AiExecutionResult>("ai_execute_claude", { filePath, prompt });
}
