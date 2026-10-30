import { expect, test, type Page } from "playwright/test";
import {
  ORIGINAL_TEXT,
  SECOND_NOTE_TEXT,
  SECOND_NOTE_TITLE,
  commentOnSelection,
  emitExternalNotesChange,
  installTauriMock,
  savedMarkdown,
  selectEditorText,
  type ExternalNotesApi,
} from "./support/tauri-mock";

test("welcome dialog can create and open the photo walk sample note", async ({ page }) => {
  await installTauriMock(page, { showWelcome: true });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Welcome to Anchor" })).toBeVisible();
  await page.getByRole("button", { name: "Create Sample Note" }).click();

  const editor = page.locator(".ProseMirror");
  await expect(
    editor.getByRole("heading", { name: "Creative Brief: Weekend Photo Walk" }),
  ).toBeVisible();
  await expect(
    page
      .locator('aside[aria-label="Documents"]')
      .getByText("Creative Brief - Weekend Photo Walk"),
  ).toBeVisible();

  const sampleContent = await page.evaluate(() => {
    const win = window as unknown as {
      __inlineMdTest?: { notes: Array<{ id: string; content: string }> };
    };
    return win.__inlineMdTest?.notes.find(
      (note) => note.id === "Creative Brief - Weekend Photo Walk",
    )?.content ?? "";
  });
  expect(sampleContent).toContain("## Shot List");
  expect(sampleContent).toContain("## Source Check");
  expect(sampleContent).toContain("Before publishing the route");
});

test("external filesystem refresh covers empty folders, new notes, active moves, and active deletes", async ({ page }) => {
  await installTauriMock(page, {
    noteContent: ["# Browser Test", "", "Original body from the active file."].join("\n"),
  });
  await page.goto("/");

  const documentsSidebar = page.getByLabel("Documents");
  const editor = page.locator(".ProseMirror");
  await expect(documentsSidebar).toContainText("Browser Test");
  await expect(editor).toContainText("Original body from the active file.");

  await page.evaluate(() => {
    const win = window as unknown as { __inlineMdTestApi: ExternalNotesApi };
    win.__inlineMdTestApi.addFolder("Inbox");
  });
  await emitExternalNotesChange(page, "/mock-notes/Inbox");
  await expect(documentsSidebar.getByText("Inbox")).toBeVisible();

  await page.evaluate(() => {
    const win = window as unknown as { __inlineMdTestApi: ExternalNotesApi };
    win.__inlineMdTestApi.addNote("Inbox/From Finder", "# From Finder\n\nNew body from Finder.");
  });
  await emitExternalNotesChange(page, "/mock-notes/Inbox/From Finder.md");
  await documentsSidebar.getByRole("button", { name: /Inbox/ }).click();
  await expect(documentsSidebar).toContainText("From Finder");

  await page.evaluate(() => {
    const win = window as unknown as { __inlineMdTestApi: ExternalNotesApi };
    win.__inlineMdTestApi.moveNote("Browser Test", "Inbox/Browser Test");
  });
  await emitExternalNotesChange(page, "/mock-notes/Inbox/Browser Test.md");
  await expect(editor).toContainText("Original body from the active file.");
  await expect(documentsSidebar).toContainText("Browser Test");

  await page.evaluate(() => {
    const win = window as unknown as { __inlineMdTestApi: ExternalNotesApi };
    win.__inlineMdTestApi.deleteNote("Inbox/Browser Test");
  });
  await emitExternalNotesChange(page, "/mock-notes/Inbox/Browser Test.md");
  await expect(editor).toContainText("New body from Finder.");
  await expect(editor).not.toContainText("Original body from the active file.");
});

test("document switch flushes pending editor content", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  const editor = page.locator(".ProseMirror");
  await expect(editor).toContainText(ORIGINAL_TEXT);

  await editor.click();
  await page.keyboard.type(" Fresh unsaved sentence.");
  await page.getByRole("button", { name: new RegExp(SECOND_NOTE_TITLE) }).click();

  await expect(editor).toContainText(SECOND_NOTE_TEXT);
  await expect.poll(() => savedMarkdown(page)).toContain("Fresh unsaved sentence.");
});

test("document switches restore sidecar comments and visual marks", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  const editor = page.locator(".ProseMirror");
  await expect(editor).toContainText(ORIGINAL_TEXT);

  await selectEditorText(page, ORIGINAL_TEXT);
  await commentOnSelection(page);

  const noteText = "Keep this claim grounded";
  const messageInput = page.getByLabel("Comment message");
  await expect(messageInput).toBeVisible();
  await messageInput.fill(noteText);
  await page.getByLabel("Send comment").click();

  await expect(page.getByText(noteText)).toBeVisible();
  await expect(page.locator("mark.comment-highlight")).toHaveCount(1);

  await page.getByRole("button", { name: new RegExp(SECOND_NOTE_TITLE) }).click();
  await expect(editor).toContainText(SECOND_NOTE_TEXT);
  // The second note has no comments, so the comments block is hidden.
  await expect(page.getByText(noteText)).toHaveCount(0);
  await expect(page.locator("mark.comment-highlight")).toHaveCount(0);

  await page.getByRole("button", { name: /Browser Test/ }).click();
  await expect(editor).toContainText(ORIGINAL_TEXT);
  const comments = page.getByRole("region", { name: "Comments" });
  await expect(comments.getByText(ORIGINAL_TEXT)).toBeVisible();
  await expect(page.locator("mark.comment-highlight")).toHaveCount(1);
  await comments.getByText(ORIGINAL_TEXT).click();
  await expect(comments.getByText(noteText)).toBeVisible();
});

test("selection Add Comment stores a plain note without calling Claude", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  const editor = page.locator(".ProseMirror");
  await expect(editor).toContainText(ORIGINAL_TEXT);

  await selectEditorText(page, ORIGINAL_TEXT);
  await commentOnSelection(page);

  const noteText = "Remember to verify this source";
  const messageInput = page.getByLabel("Comment message");
  await expect(messageInput).toBeVisible();
  await expect(messageInput).toHaveAttribute("placeholder", "Leave a note for yourself…");
  await messageInput.fill(noteText);
  await page.getByLabel("Send comment").click();

  await expect(page.getByText(noteText)).toBeVisible();
  await messageInput.fill("Second private reminder");
  await page.getByLabel("Send comment").click();
  await expect(page.getByText("Second private reminder")).toBeVisible();
  await expect(editor).toContainText(ORIGINAL_TEXT);

  const aiInvocationCount = await page.evaluate(() => {
    const win = window as unknown as {
      __inlineMdTest?: { invocations: Array<{ cmd: string }> };
    };
    return (
      win.__inlineMdTest?.invocations.filter(({ cmd }) =>
        cmd.startsWith("claude_session")
      ).length ?? 0
    );
  });
  expect(aiInvocationCount).toBe(0);
});

test("settings window lists its sections and themes repaint the app", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.emulateMedia({ colorScheme: "dark" });

  await page.getByRole("button", { name: "Settings" }).click();
  const sections = page.getByRole("navigation", { name: "Settings sections" });
  for (const name of ["General", "Appearance", "Claude", "Shortcuts", "About"]) {
    await expect(sections.getByRole("button", { name })).toBeVisible();
  }
  await expect(page.getByText("/mock-notes")).toBeVisible();

  await sections.getByRole("button", { name: "Appearance" }).click();
  await page.getByRole("radio", { name: "Dark" }).click();
  const root = page.locator("html");
  await expect(root).not.toHaveAttribute("data-anchor-theme", /.+/);

  for (const theme of ["Clay", "Graphite", "Paper", "Sepia", "Nord", "Solarized", "Catppuccin", "Anchor"]) {
    await page.getByRole("radio", { name: new RegExp(`^Aa\\s*${theme}`) }).click();
    if (process.env.ANCHOR_THEME_SHOTS) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${process.env.ANCHOR_THEME_SHOTS}/${theme.toLowerCase()}-dark.png` });
      await page.getByRole("button", { name: "Settings" }).click();
      await sections.getByRole("button", { name: "Appearance" }).click();
    }
  }

  await page.getByRole("radio", { name: /^Aa\s*Clay/ }).click();
  await expect(root).toHaveAttribute("data-anchor-theme", "clay");
  const background = () => page.evaluate(() => document.documentElement.style.getPropertyValue("--background"));
  expect(await background()).toBe("#262624");
  await page.getByRole("radio", { name: "Light" }).click();
  await expect.poll(background).toBe("#faf9f5");

  // A changed field shows Reset; the change survives a reload.
  const accent = page.getByLabel("Accent hex value");
  await accent.fill("#123456");
  await accent.press("Enter");
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--primary"))).toBe("#123456");
  await expect(page.getByRole("button", { name: "Reset" })).toBeVisible();
  if (process.env.ANCHOR_THEME_SHOTS) {
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${process.env.ANCHOR_THEME_SHOTS}/settings-appearance-clay-light.png` });
  }
  await page.reload();
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await expect(root).toHaveAttribute("data-anchor-theme", "clay");
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--primary"))).toBe("#123456");
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--font-editor"))).toContain("Newsreader");

  await page.getByRole("button", { name: "Settings" }).click();
  await sections.getByRole("button", { name: "About" }).click();
  await expect(page.getByText("Version 0.1.4")).toBeVisible();
  await sections.getByRole("button", { name: "Claude" }).click();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  if (process.env.ANCHOR_THEME_SHOTS) {
    await page.screenshot({ path: `${process.env.ANCHOR_THEME_SHOTS}/settings-claude.png` });
    await sections.getByRole("button", { name: "Shortcuts" }).click();
    await page.mouse.move(5, 5);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${process.env.ANCHOR_THEME_SHOTS}/settings-shortcuts.png` });
  }
});


test("a change written outside Anchor lands in place, selected, and ⌘Z undoes it", async ({ page }) => {
  await installTauriMock(page, {
    noteContent: ["# Browser Test", "", "First paragraph stays.", "", "Old middle sentence.", "", "Last paragraph stays."].join("\n"),
  });
  await page.goto("/");
  const editor = page.locator(".ProseMirror");
  await expect(editor).toContainText("Old middle sentence.");

  await page.evaluate(() => {
    const win = window as unknown as { __inlineMdTestApi: ExternalNotesApi };
    win.__inlineMdTestApi.addNote(
      "Browser Test",
      ["# Browser Test", "", "First paragraph stays.", "", "New middle sentence from Claude.", "", "Last paragraph stays."].join("\n"),
    );
  });
  await emitExternalNotesChange(page, "/mock-notes/Browser Test.md");

  await expect(editor).toContainText("New middle sentence from Claude.");
  await expect(page.getByText("Changed outside Anchor", { exact: true })).toHaveCount(0);
  // Only the changed words are replaced, and they stay selected and drawn.
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() || document.querySelector(".pinned-selection")?.textContent || ""))
    .toContain("New");
  await expect(page.locator(".pinned-selection")).toContainText("New");
  await expect(page.locator(".pinned-selection")).not.toContainText("First paragraph");

  await editor.click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor).toContainText("Old middle sentence.");
  await expect.poll(() => savedMarkdown(page)).toContain("Old middle sentence.");
});

test("mermaid code blocks render as diagrams and open for editing on double-click", async ({ page }) => {
  await installTauriMock(page, {
    noteContent: ["# Browser Test", "", "Intro.", "", "```mermaid", "flowchart TD", "  A[Start] --> B[Finish]", "```", "", "After."].join("\n"),
  });
  await page.goto("/");
  const preview = page.locator(".mermaid-preview");
  await expect(preview.locator("svg")).toBeVisible({ timeout: 15_000 });
  await expect(preview).toContainText("Start");
  await expect(page.locator(".code-block-view pre")).toBeHidden();

  await preview.dblclick();
  await expect(page.locator(".code-block-view pre")).toBeVisible();
  await expect(page.locator(".code-block-view pre")).toContainText("flowchart TD");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.type(" --> C[Again]");

  // Leaving the block renders it again and the file keeps the fenced source.
  await page.locator(".ProseMirror p", { hasText: "After." }).click();
  await expect(page.locator(".code-block-view pre")).toBeHidden();
  await expect(preview).toContainText("Again", { timeout: 15_000 });
  await expect.poll(() => savedMarkdown(page)).toContain("C[Again]");
  expect(await savedMarkdown(page)).toContain("```mermaid\nflowchart TD");
});

test("paragraph spacing setting changes the gap between paragraphs", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  const editor = page.locator(".ProseMirror");
  await expect(editor).toHaveAttribute("data-spacing", "medium");
  const gap = () =>
    editor.locator("p").first().evaluate((p) => parseFloat(getComputedStyle(p).marginBottom));
  const medium = await gap();

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Appearance" }).click();
  await page.getByLabel("Paragraph spacing").click();
  await page.getByRole("option", { name: "Small" }).click();
  await expect(editor).toHaveAttribute("data-spacing", "small");
  expect(await gap()).toBeLessThan(medium);
  await page.getByLabel("Paragraph spacing").click();
  await page.getByRole("option", { name: "Large" }).click();
  await expect(editor).toHaveAttribute("data-spacing", "large");
  expect(await gap()).toBeGreaterThan(medium);
});

test("a refresh with nothing changed reads no notes", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toContainText("The original sentence needs work.");
  const reads = () =>
    page.evaluate(() => {
      const win = window as unknown as { __inlineMdTest: { invocations: Array<{ cmd: string; args: { ids?: string[] } }> } };
      return win.__inlineMdTest.invocations
        .filter((i) => i.cmd === "read_notes")
        .reduce((sum, i) => sum + (i.args.ids?.length ?? 0), 0);
    });
  const afterBoot = await reads();
  await emitExternalNotesChange(page, "/mock-notes/Browser Test.md");
  await page.waitForTimeout(600);
  expect(await reads()).toBe(afterBoot);

  // Changing one note reads just that one.
  await page.evaluate(() => {
    const win = window as unknown as { __inlineMdTestApi: ExternalNotesApi };
    win.__inlineMdTestApi.addNote("Second Note", "# Second Note\n\nEdited elsewhere.");
  });
  await emitExternalNotesChange(page, "/mock-notes/Second Note.md");
  await expect.poll(reads).toBe(afterBoot + 1);
});

async function dragRow(page: Page, from: string, to: string): Promise<void> {
  const source = page.locator(`[data-tree-label="${from}"]`).first();
  const target = page.locator(`[data-tree-label="${to}"]`).first();
  const a = await source.boundingBox();
  const b = await target.boundingBox();
  if (!a || !b) throw new Error("rows not found");
  await page.mouse.move(a.x + 20, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 30, a.y + a.height / 2 + 6, { steps: 3 });
  await page.mouse.move(b.x + 30, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
}

test("notes and folders move by dragging them in the documents list", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toContainText("The original sentence needs work.");
  await page.evaluate(() => {
    const win = window as unknown as { __inlineMdTestApi: ExternalNotesApi };
    win.__inlineMdTestApi.addFolder("Inbox");
    win.__inlineMdTestApi.addFolder("Archive");
    win.__inlineMdTestApi.emitNotesChanged("/mock-notes/Archive");
  });
  const list = page.getByRole("complementary", { name: "Documents" });
  await expect(list.getByText("Inbox")).toBeVisible();

  await dragRow(page, "Second Note.md", "Inbox");
  await expect.poll(() =>
    page.evaluate(() => (window as unknown as { __inlineMdTest: { notes: Array<{ id: string }> } }).__inlineMdTest.notes.map((n) => n.id)),
  ).toContain("Inbox/Second Note");

  await dragRow(page, "Inbox", "Archive");
  await expect.poll(() =>
    page.evaluate(() => (window as unknown as { __inlineMdTest: { notes: Array<{ id: string }> } }).__inlineMdTest.notes.map((n) => n.id)),
  ).toContain("Archive/Inbox/Second Note");
  // A plain click on a row still opens it.
  await expect(page.locator(".ProseMirror")).toContainText("The original sentence needs work.");
});

test("⌥⌘C copies the selected item's path and headers move the window", async ({ page }) => {
  await installTauriMock(page);
  await page.addInitScript(() => {
    const copied: string[] = [];
    (window as unknown as { __copied: string[] }).__copied = copied;
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (text: string) => void copied.push(text) },
      configurable: true,
    });
  });
  await page.goto("/");
  await page.locator('[data-tree-label="Second Note.md"]').click();
  await page.keyboard.press("Meta+Alt+KeyC");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)).toEqual([
    "/mock-notes/Second Note.md",
  ]);
  await expect(page.getByText("Path copied")).toBeVisible();

  const dragCalls = () =>
    page.evaluate(
      () =>
        (window as unknown as { __inlineMdTest: { invocations: Array<{ cmd: string }> } }).__inlineMdTest.invocations.filter(
          (i) => i.cmd === "plugin:window|start_dragging",
        ).length,
    );
  const toolbar = page.locator("[data-window-drag]").filter({ has: page.getByRole("button", { name: "Settings" }) });
  const box = await toolbar.boundingBox();
  if (!box) throw new Error("toolbar missing");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(dragCalls).toBe(1);
  await page.getByRole("button", { name: "Bold (⌘B)" }).click();
  expect(await dragCalls()).toBe(1);
});


test("the open note comes back after a relaunch", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await page.locator('[data-tree-label="Second Note.md"]').click();
  await expect(page.locator(".ProseMirror")).toContainText("This is another note.");
  await page.reload();
  await expect(page.locator(".ProseMirror")).toContainText("This is another note.");
});

test("unsaved typing survives a change Claude writes elsewhere in the note", async ({ page }) => {
  await installTauriMock(page, {
    noteContent: ["# Browser Test", "", "First paragraph stays.", "", "Middle paragraph.", "", "Last paragraph stays."].join("\n"),
  });
  await page.goto("/");
  const editor = page.locator(".ProseMirror");
  await expect(editor).toContainText("Last paragraph stays.");
  await page.locator(".ProseMirror p", { hasText: "Last paragraph stays." }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Typed just now.");
  // Before Anchor saves the typing, Claude rewrites the first paragraph.
  await page.evaluate(() => {
    const win = window as unknown as { __inlineMdTestApi: ExternalNotesApi };
    win.__inlineMdTestApi.addNote(
      "Browser Test",
      ["# Browser Test", "", "First paragraph, rewritten by Claude.", "", "Middle paragraph.", "", "Last paragraph stays."].join("\n"),
    );
  });
  await emitExternalNotesChange(page, "/mock-notes/Browser Test.md");
  await expect(editor).toContainText("First paragraph, rewritten by Claude.");
  await expect(editor).toContainText("Last paragraph stays. Typed just now.");
  await expect.poll(() => savedMarkdown(page)).toContain("Typed just now.");
  expect(await savedMarkdown(page)).toContain("rewritten by Claude");
});

test("rows open their menu from the keyboard and folders can move without dragging", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toContainText("The original sentence needs work.");
  await page.evaluate(() => {
    const win = window as unknown as { __inlineMdTestApi: ExternalNotesApi };
    win.__inlineMdTestApi.addFolder("Inbox");
    win.__inlineMdTestApi.addFolder("Archive");
    win.__inlineMdTestApi.emitNotesChanged("/mock-notes/Archive");
  });
  const inbox = page.locator('[data-tree-label="Inbox"]');
  await expect(inbox).toBeVisible();
  await inbox.focus();
  await page.keyboard.press("Shift+F10");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Move to folder" }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await expect.poll(() =>
    page.evaluate(() =>
      (window as unknown as { __inlineMdTest: { invocations: Array<{ cmd: string; args: { id?: string; targetParent?: string } }> } }).__inlineMdTest.invocations
        .filter((i) => i.cmd === "move_folder")
        .map((i) => `${i.args.id}->${i.args.targetParent}`),
    ),
  ).toEqual(["Inbox->Archive"]);
});

test("settings tiles move with arrow keys and closing returns focus to the gear", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  const gear = page.getByRole("button", { name: "Settings" });
  await gear.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Appearance" }).click();
  await page.getByRole("radio", { name: /^Aa\s*Anchor/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: /^Aa\s*Clay/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: /^Aa\s*Clay/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(gear).toBeFocused();
});
