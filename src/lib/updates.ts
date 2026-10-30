import { isTauri } from "@tauri-apps/api/core";

// Checks GitHub Releases for a newer Anchor once per launch (release builds
// only) and offers to install it. Failures stay quiet: the feed only works
// once the repo is public, and an offline launch shouldn't nag.
export async function checkForUpdates(): Promise<void> {
  if (!isTauri() || import.meta.env.DEV) return;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return;
    const { ask } = await import("@tauri-apps/plugin-dialog");
    const install = await ask(
      `Anchor ${update.version} is available (you have ${update.currentVersion}). Install it and restart?`,
      { title: "Update available", kind: "info", okLabel: "Install and Restart", cancelLabel: "Later" },
    );
    if (!install) return;
    await update.downloadAndInstall();
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (error) {
    console.warn("Update check failed", error);
  }
}
