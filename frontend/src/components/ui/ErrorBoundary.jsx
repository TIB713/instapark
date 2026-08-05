import React from "react";
import { AlertTriangle, RefreshCcw } from "lucide-react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl text-center border border-gray-100">
            <div className="w-16 h-16 bg-red-100 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <h1 className="font-heading text-2xl font-bold text-[#0F2044] mb-3">Something went wrong</h1>
            <p className="text-gray-500 text-sm mb-8 leading-relaxed">
              We encountered an unexpected error while loading this page. Please try reloading.
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-[#1A3C6E] hover:bg-[#0F2044] text-white px-6 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition shadow-lg shadow-[#1A3C6E]/20"
            >
              <RefreshCcw className="w-4 h-4" /> Reload Page
            </button>
            
            {process.env.NODE_ENV === "development" && this.state.error && (
              <div className="mt-8 text-left bg-gray-100 p-4 rounded-xl overflow-auto text-xs font-mono text-gray-700 max-h-48">
                {this.state.error.toString()}
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
