import { Component, type ErrorInfo, type ReactNode } from "react";
import { analytics } from "@/lib/analytics/track";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** React error boundary that reports into telemetry and shows a fallback UI. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    analytics.trackRaw({
      event: "app:critical",
      level: "critical",
      payload: {
        message: String(error?.message ?? error).slice(0, 300),
        componentStack: info.componentStack?.slice(0, 500),
      },
    });
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div role="alert" className="container" style={{ paddingBlock: "var(--space-7)", textAlign: "center" }}>
          <h2 className="text-xl font-semibold">Что-то пошло не так</h2>
          <p className="text-muted-foreground">Страница временно недоступна. Обновите страницу.</p>
          <button
            type="button"
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground"
            onClick={() => window.location.reload()}
          >
            Обновить
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}