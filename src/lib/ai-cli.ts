import { invoke } from "@tauri-apps/api/core";

export interface AiExecutionResult {
  success: boolean;
  output: string;
  error: string | null;
}

export async function checkClaudeCli(): Promise<boolean> {
  return invoke<boolean>("ai_check_claude_cli");
}

export async function chatClaude(prompt: string): Promise<AiExecutionResult> {
  return invoke<AiExecutionResult>("ai_chat_claude", { prompt });
}

export async function executeClaudeEdit(
  filePath: string,
  prompt: string,
): Promise<AiExecutionResult> {
  return invoke<AiExecutionResult>("ai_execute_claude", { filePath, prompt });
}
