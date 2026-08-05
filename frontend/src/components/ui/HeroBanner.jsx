import React from "react";

export default function HeroBanner({ title, subtitle, meta = [], badge, actions, rightSlot, titleClassName = "font-heading text-3xl font-bold" }) {
  return (
    <div className="w-full bg-gradient-to-br from-[#0F2044] to-[#1A3C6E] text-white rounded-2xl p-8 mb-8">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className={titleClassName}>{title}</h1>
            {badge ? <div className="shrink-0">{badge}</div> : null}
          </div>
          {subtitle ? <p className="text-white/70 text-sm mt-2">{subtitle}</p> : null}
          {meta.length > 0 ? (
            <div className="flex flex-wrap gap-5 mt-6 justify-start w-full">
              {meta.map((item, idx) => {
                const Icon = item.icon;
                return (
                  <div key={`${item.label}-${idx}`} className={`flex flex-col items-center gap-1 min-w-[60px] border-r border-white/10 last:border-0 ${idx === 0 ? "pr-5" : "px-5"}`}>
                    {Icon ? <Icon className="w-5 h-5 text-white/40 mx-auto" /> : null}
                    <div className="text-white font-black text-xl leading-none text-center">{item.value}</div>
                    <div className="text-white/50 text-[10px] uppercase tracking-widest font-bold text-center">{item.label}</div>
                  </div>
                );
              })}
            </div>
          ) : null}
          {actions ? <div className="mt-5">{actions}</div> : null}
        </div>
        {rightSlot ? <div className="shrink-0">{rightSlot}</div> : null}
      </div>
    </div>
  );
}
