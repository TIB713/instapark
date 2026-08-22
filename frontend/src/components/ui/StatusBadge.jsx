import {
  Bell,
  Car,
  CheckCheck,
  CheckCircle2,
  Clock,
  Loader2,
  X,
} from "lucide-react";
import React from "react";

const CONFIG = {
  PRE_REGISTERED: {
    className: "bg-purple-100 text-purple-700",
    Icon: Clock,
    pulse: false,
    spin: false,
  },
  CHECKED_IN: {
    className: "bg-blue-100 text-blue-700",
    Icon: Car,
    pulse: true,
    spin: false,
  },
  PARKED: {
    className: "bg-emerald-100 text-emerald-700",
    Icon: CheckCircle2,
    pulse: false,
    spin: false,
  },
  RETRIEVAL_REQUESTED: {
    className: "bg-amber-100 text-amber-700",
    Icon: Bell,
    pulse: true,
    spin: false,
  },
  ACCEPTED: {
    className: "bg-yellow-100 text-yellow-700",
    Icon: Car,
    pulse: false,
    spin: false,
  },
  BEING_FETCHED: {
    className: "bg-orange-100 text-orange-700",
    Icon: Loader2,
    pulse: false,
    spin: true,
  },
  DELIVERED: {
    className: "bg-gray-100 text-gray-500",
    Icon: CheckCheck,
    pulse: false,
    spin: false,
  },
  CANCELLED: {
    className: "bg-red-100 text-red-500",
    Icon: X,
    pulse: false,
    spin: false,
  },
  closed: {
    className: "bg-gray-100 text-gray-600",
    Icon: CheckCheck,
    pulse: false,
    spin: false,
  },
  active: {
    className: "bg-emerald-100 text-emerald-700",
    Icon: CheckCircle2,
    pulse: false,
    spin: false,
  },
  inactive: {
    className: "bg-red-100 text-red-600",
    Icon: X,
    pulse: false,
    spin: false,
  },
};

function humanizeStatus(status) {
  if (!status) return "";
  return String(status)
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function StatusBadge({ status, size = "sm" }) {
  const cfg = CONFIG[status] || {
    className: "bg-gray-100 text-gray-600",
    Icon: Clock,
    pulse: false,
    spin: false,
  };
  const { Icon } = cfg;

  const isLg = size === "lg";
  const base =
    "inline-flex items-center gap-1.5 rounded-full font-semibold";
  const sizing = isLg ? "px-3 py-1.5 text-sm" : "px-2.5 py-1 text-xs";
  const iconSize = isLg ? "w-[14px] h-[14px]" : "w-[12px] h-[12px]";

  return (
    <span className={`${base} ${sizing} ${cfg.className}`}>
      {cfg.pulse && (
        <span className="w-1.5 h-1.5 rounded-full bg-current pulse-dot" />
      )}
      <Icon className={`${iconSize} ${cfg.spin ? "animate-spin" : ""}`} />
      <span>{humanizeStatus(status)}</span>
    </span>
  );
}

