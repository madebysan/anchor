import type { ThreadMessage } from "@/types";

export function formatThreadHistory(messages: ThreadMessage[]): string {
  const history = messages.filter((message) => {
    if (message.role === "assistant" && message.content.trim() === "") {
      return false;
    }
    return true;
  });

  if (history.length === 0) return "(no prior thread messages)";

  return history
    .map((message) => {
      const label = message.role === "assistant" ? "Assistant" : "User";
      const trigger = message.trigger ? ` [@${message.trigger.type}]` : "";
      return `${label}${trigger}: ${message.content}`;
    })
    .join("\n\n");
}
