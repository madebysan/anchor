import { invoke } from "@tauri-apps/api/core";

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
