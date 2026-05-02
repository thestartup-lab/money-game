import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
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

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-950 p-6">
          <div className="card max-w-md w-full text-center space-y-4">
            <div className="text-4xl">⚠️</div>
            <h2 className="text-xl font-bold text-red-400">畫面發生錯誤</h2>
            <p className="text-gray-400 text-sm">
              {this.state.error?.message ?? '未知錯誤'}
            </p>
            <button
              className="btn-primary w-full"
              onClick={() => window.location.reload()}
            >
              重新整理頁面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
