import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { TrendingUp, TrendingDown } from "lucide-react";

const getAccentFillClass = (accent = "") => {
  if (accent.includes("emerald")) return "bg-emerald-500";
  if (accent.includes("amber")) return "bg-amber-500";
  if (accent.includes("rose")) return "bg-rose-500";
  if (accent.includes("indigo")) return "bg-indigo-500";
  if (accent.includes("blue")) return "bg-blue-500";
  if (accent.includes("ownerGold")) return "bg-ownerGold";
  return "bg-[#1A3C6E]";
};

export default function StatCard({ label, value, icon, to, accent, testid, sub, trend, progress }) {
  const [displayValue, setDisplayValue] = useState(value);

  useEffect(() => {
    // Check if the value is a number or can be cast to one (and is not a string with non-numeric chars like '10/20')
    const target = typeof value === "number" ? value : Number(value);
    
    // If it's a string like "10/20" or "—", Number() will be NaN, so we just display it statically.
    if (!Number.isFinite(target) || (typeof value === 'string' && value.includes('/'))) {
      setDisplayValue(value);
      return;
    }

    const durationMs = 600;
    const stepMs = 24;
    const steps = Math.max(1, Math.floor(durationMs / stepMs));
    const increment = target / steps;
    let current = 0;

    const timer = setInterval(() => {
      current += increment;
      if (current >= target) {
        setDisplayValue(Math.round(target));
        clearInterval(timer);
      } else {
        setDisplayValue(Math.round(current));
      }
    }, stepMs);

    return () => clearInterval(timer);
  }, [value]);

  const trendColor =
    trend?.direction === "up"
      ? "text-emerald-600"
      : trend?.direction === "down"
      ? "text-red-600"
      : "text-gray-500";

  const content = (
    <>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">{label}</div>
          <div className="font-heading text-3xl font-bold mt-2 text-[#0F2044]">{displayValue}</div>
          {trend && (
            <div className={`mt-1 inline-flex items-center gap-1 text-xs font-semibold ${trendColor}`}>
              {trend.direction === "up" ? (
                <TrendingUp className="w-3.5 h-3.5" />
              ) : trend.direction === "down" ? (
                <TrendingDown className="w-3.5 h-3.5" />
              ) : (
                <span className="w-3.5 h-3.5 inline-block text-center">-</span>
              )}
              <span>{trend.value}</span>
            </div>
          )}
          {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
        </div>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${accent} transition-transform duration-200 group-hover:scale-110`}>
          {icon}
        </div>
      </div>
      {typeof progress === "number" && (
        <div className="mt-4 h-1 w-full rounded-full bg-gray-100 overflow-hidden">
          <div
            className={`h-full rounded-full ${getAccentFillClass(accent)}`}
            style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
          />
        </div>
      )}
    </>
  );

  if (to) {
    return (
      <Link to={to} data-testid={testid}
            className="group bg-white rounded-2xl shadow-card border border-gray-100 p-4 sm:p-6 hover:-translate-y-1 hover:ring-1 hover:ring-[#1A3C6E]/20 transition cursor-pointer block">
        {content}
      </Link>
    );
  }

  return (
    <div data-testid={testid} className="group bg-white rounded-2xl shadow-card border border-gray-100 p-4 sm:p-6 hover:ring-1 hover:ring-[#1A3C6E]/20 transition">
      {content}
    </div>
  );
}
