import { test } from "playwright/test";
import { emitExternalNotesChange, installTauriMock, selectEditorText, type ExternalNotesApi } from "./support/tauri-mock";

// Captures assets/screenshot.png for the README from invented demo notes, the
// same every time. Skipped in normal test runs:
//   README_SCREENSHOT=1 npx playwright test tests/readme-screenshot.spec.ts

test.use({ deviceScaleFactor: 2 });

const BEFORE = [
  "# Lisbon weekend",
  "",
  "Two slow days. One fixed plan each morning, the rest left open.",
  "",
  "## Saturday",
  "",
  "Coffee in Príncipe Real, then walk down to the river. Spend the afternoon at LX Factory, see the tile museum, and get to the Miradouro for sunset.",
  "",
  "```mermaid",
  "flowchart LR",
  "  A[Coffee in Príncipe Real] --> B[Walk to the river]",
  "  B --> C[LX Factory]",
  "  C --> D[Sunset at the Miradouro]",
  "```",
  "",
  "## Sunday",
  "",
  "- Pastéis de nata in Belém before the queue",
  "- Ferry to Cacilhas for lunch",
  "- Pack, early train home",
].join("\n");

const AFTER = BEFORE.replace(
  "Spend the afternoon at LX Factory, see the tile museum, and get to the Miradouro for sunset.",
  "Spend a slow afternoon at LX Factory, then head up to the Miradouro for sunset. Leave the tile museum for next time.",
);

const event = (value: unknown) => JSON.stringify(value);

const REPLY = [
  event({ type: "system", subtype: "init", session_id: "demo-session" }),
  event({
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "Trips/Lisbon weekend.md" } }] },
  }),
  event({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1" }] } }),
  event({
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "t2", name: "Edit", input: { file_path: "Trips/Lisbon weekend.md" } }] },
  }),
  event({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2" }] } }),
  event({
    type: "assistant",
    message: {
      content: [
        {
          type: "text",
          text: "I dropped the tile museum from Saturday and kept LX Factory and the sunset, so the afternoon has room to wander. The diagram already matches.",
        },
      ],
    },
  }),
  event({ type: "result", subtype: "success", session_id: "demo-session", is_error: false }),
];

test("README screenshot", async ({ page }) => {
  test.skip(!process.env.README_SCREENSHOT, "Set README_SCREENSHOT=1 to capture the README image.");
  await installTauriMock(page, {
    folders: ["Trips", "Work"],
    notes: [
      { id: "Trips/Lisbon weekend", content: BEFORE },
      { id: "Trips/Packing list", content: "# Packing list\n\n- Passport\n- Walking shoes" },
      { id: "Work/Launch plan", content: "# Launch plan\n\nShip the beta to ten people first." },
      { id: "Work/Meeting notes", content: "# Meeting notes\n\nDecisions only." },
      { id: "Ideas", content: "# Ideas\n\nA small garden on the balcony." },
      { id: "Reading list", content: "# Reading list\n\n- The Overstory" },
    ],
    activeNote: "Trips/Lisbon weekend",
    folderLabel: "Notes",
    claudeReplies: [REPLY],
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await page.locator(".mermaid-preview svg").waitFor({ timeout: 15_000 });
  await page.locator('[data-tree-label="Trips"]').click();
  await page.locator('[data-tree-label="Lisbon weekend.md"]').click();
  await page.locator(".mermaid-preview svg").waitFor({ timeout: 15_000 });

  await selectEditorText(page, "Spend the afternoon at LX Factory, see the tile museum, and get to the Miradouro for sunset.");
  // Let the selection reach the chat panel as a quote.
  await page.waitForTimeout(400);
  const input = page.getByLabel("Message Claude");
  await input.click();
  await input.fill("Make Saturday afternoon slower");
  await input.press("Enter");

  // Claude's Edit lands on disk; Anchor applies it in place.
  await page.waitForTimeout(400);
  await page.evaluate((content) => {
    const win = window as unknown as { __inlineMdTestApi: ExternalNotesApi };
    win.__inlineMdTestApi.addNote("Trips/Lisbon weekend", content);
  }, AFTER);
  await emitExternalNotesChange(page, "/mock-notes/Trips/Lisbon weekend.md");
  await page.getByText("The diagram already matches.").waitFor();
  await page.mouse.move(1270, 790);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "assets/screenshot.png", scale: "device" });
});
