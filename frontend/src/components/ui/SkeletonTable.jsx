import React from "react";

const CELL_WIDTHS = ["w-24", "w-32", "w-20", "w-16"];

export default function SkeletonTable({ rows = 5, cols = 6 }) {
  return (
    <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden animate-pulse">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            {Array.from({ length: cols }).map((_, i) => (
              <th key={`h-${i}`} className="px-5 py-3">
                <div className="h-3 w-16 rounded bg-gray-200" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={`r-${r}`} className="border-t border-gray-100">
              {Array.from({ length: cols }).map((__, c) => (
                <td key={`c-${r}-${c}`} className="px-5 py-3">
                  <div
                    className={`h-4 rounded bg-gray-200 ${
                      CELL_WIDTHS[(r + c) % CELL_WIDTHS.length]
                    }`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SkeletonCard({ count = 4 }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={`card-${i}`}
          className="bg-white rounded-2xl shadow-card border border-gray-100 p-4"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="h-3 w-20 rounded bg-gray-200" />
            <div className="h-8 w-8 rounded-lg bg-gray-200" />
          </div>
          <div className="h-7 w-24 rounded bg-gray-200 mb-2" />
          <div className="h-3 w-16 rounded bg-gray-200" />
        </div>
      ))}
    </div>
  );
}

