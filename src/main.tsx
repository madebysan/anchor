import "./styles.css";
import "./lib/fonts";

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyAppearance, loadAppearance } from "./lib/appearance";

// Paint the saved theme before React mounts so the window doesn't flash the
// default colors. next-themes keeps the mode in localStorage under "theme".
function startsDark(): boolean {
  try {
    const mode = localStorage.getItem("theme");
    if (mode === "dark") return true;
    if (mode === "light") return false;
  } catch {
    // Fall through to the system setting.
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
applyAppearance(loadAppearance(), startsDark());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
