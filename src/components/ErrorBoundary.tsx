import React from 'react';

interface Props { children: React.ReactNode }
interface State { error: Error | null }

/**
 * App-wide error boundary. A render-time throw in any tab (e.g. a malformed order
 * or chart datum) would otherwise blank the entire console with no recovery. This
 * catches it and offers a reload, so one bad record can't take down the whole admin.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Route to a real logger in production; console keeps a breadcrumb for now.
    // eslint-disable-next-line no-console
    console.error('Admin console crashed:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-stone-100 p-4">
          <div className="bg-white border-4 border-black shadow-brutalist p-8 max-w-md text-center">
            <h1 className="font-black uppercase text-xl mb-2">Something broke</h1>
            <p className="text-stone-500 text-sm mb-4">
              The console hit an unexpected error and stopped rendering. Reloading usually fixes it.
            </p>
            <p className="text-[11px] font-mono text-stone-400 break-words mb-4">
              {this.state.error.message}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-black text-white font-black uppercase text-sm py-3 border-2 border-black shadow-brutalist hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
