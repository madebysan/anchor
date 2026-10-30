import { useLayoutEffect } from "react";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { applyAppearance, useAppearanceStore } from "@/lib/appearance";

/** Keeps the chosen theme's colors and fonts on <html> as the mode changes. */
function AppearanceSync() {
  const { resolvedTheme } = useTheme();
  const themeId = useAppearanceStore((s) => s.themeId);
  const colors = useAppearanceStore((s) => s.colors);
  const fonts = useAppearanceStore((s) => s.fonts);
  useLayoutEffect(() => {
    applyAppearance({ themeId, colors, fonts }, resolvedTheme === "dark");
  }, [themeId, colors, fonts, resolvedTheme]);
  return null;
}

export default function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem>
      <AppearanceSync />
      {children}
    </NextThemesProvider>
  );
}
