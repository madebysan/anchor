import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: "./tests",
  reporter: "list",
  use: {
    trace: "retain-on-failure",
  },
});
