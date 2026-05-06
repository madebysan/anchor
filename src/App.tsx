import ThemeProvider from "@/components/ThemeProvider";
import EditorPage from "@/components/editor/EditorPage";

export default function App() {
  return (
    <div className="font-sans antialiased">
      <ThemeProvider>
        <EditorPage />
      </ThemeProvider>
    </div>
  );
}
