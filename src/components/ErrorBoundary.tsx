import React from "react";

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="min-h-dvh bg-background p-8 font-sans text-foreground">
          <h1 className="mb-4 text-lg font-semibold text-destructive">Render error</h1>
          <pre
            className="whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs leading-relaxed"
          >
            {this.state.error.message}
            {"\n\n"}
            {this.state.error.stack}
          </pre>
        </main>
      );
    }
    return this.props.children;
  }
}
