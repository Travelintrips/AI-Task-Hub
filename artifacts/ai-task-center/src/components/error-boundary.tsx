import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Uncaught error:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 max-w-md">
            <h2 className="text-lg font-semibold text-destructive mb-2">Terjadi Kesalahan</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Komponen ini mengalami error. Coba muat ulang halaman atau hubungi administrator.
            </p>
            {this.state.error && (
              <pre className="text-xs text-left bg-muted rounded p-3 overflow-auto max-h-32">
                {this.state.error.message}
              </pre>
            )}
            <button
              className="mt-4 text-sm underline text-primary"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              Coba Lagi
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
