import { Component, type ComponentType, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { reportPlatformError } from "@/lib/platform-error-reporting";

interface Props {
  children: ReactNode;
  fallback?: ReactNode | ((ctx: { error: Error; reset: () => void }) => ReactNode);
  onReset?: () => void;
  /** Tag for log aggregation (e.g. "admin.dashboard.live-feed"). */
  section?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

const isDev =
  typeof process !== "undefined" && process.env && process.env.NODE_ENV !== "production";

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    const section = this.props.section ?? "unknown";
    console.error(`[ErrorBoundary:${section}]`, error, info.componentStack);
    reportPlatformError(error, {
      boundary: "section",
      section,
      componentStack: info.componentStack,
    });
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError && this.state.error) {
      const { fallback } = this.props;
      if (typeof fallback === "function") {
        return fallback({ error: this.state.error, reset: this.reset });
      }
      if (fallback !== undefined) return fallback;
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mb-4">
            <AlertTriangle className="w-7 h-7 text-rose-400" aria-hidden="true" />
          </div>
          <h2 className="text-white font-bold text-xl mb-2">Something went wrong</h2>
          <p className="text-white/50 text-sm max-w-sm mb-6">
            This section encountered an error. Your data is safe. Try refreshing the page or contact
            support if the problem persists.
          </p>
          {isDev && (
            <pre className="text-xs text-rose-400 bg-rose-500/5 border border-rose-500/10 rounded-xl p-4 text-left max-w-lg overflow-auto mb-4">
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={this.reset}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm font-medium transition-colors"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children as ReactNode;
  }
}

export function withErrorBoundary<T extends object>(
  Wrapped: ComponentType<T>,
  fallback?: ReactNode,
) {
  return function WrappedWithBoundary(props: T) {
    return (
      <ErrorBoundary fallback={fallback}>
        <Wrapped {...props} />
      </ErrorBoundary>
    );
  };
}

export function SectionErrorFallback({
  message,
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="glass-card p-5 text-center text-white/60 text-sm space-y-3">
      <div className="flex items-center justify-center gap-2 text-rose-300">
        <AlertTriangle className="w-4 h-4" aria-hidden="true" />
        <span>{message ?? "This section could not load."}</span>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-medium"
        >
          <RefreshCw className="w-3 h-3" aria-hidden="true" />
          Retry
        </button>
      )}
    </div>
  );
}

/**
 * SectionBoundary — Query-aware wrapper. On retry it invalidates the supplied
 * query keys and resets the boundary so children re-mount and refetch.
 */
export function SectionBoundary({
  section,
  children,
  invalidateKeys,
  message,
}: {
  section: string;
  children: ReactNode;
  invalidateKeys?: QueryKey[];
  message?: string;
}) {
  const qc = useQueryClient();
  return (
    <ErrorBoundary
      section={section}
      onReset={() => {
        invalidateKeys?.forEach((key) => qc.invalidateQueries({ queryKey: key }));
      }}
      fallback={({ reset }) => (
        <SectionErrorFallback message={message ?? "This section could not load."} onRetry={reset} />
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
