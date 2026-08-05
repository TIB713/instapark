import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error("ErrorBoundary caught:", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-6 text-center">
          <h2 className="text-xl font-bold text-gray-900">Something went wrong.</h2>
          <p className="text-sm text-gray-500 max-w-md">{this.state.error?.message || "An unexpected error occurred."}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-xl bg-[#1A3C6E] text-white text-sm font-semibold"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
