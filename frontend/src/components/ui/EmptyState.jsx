import React from "react";

export default function EmptyState({ icon, title, description, action, theme }) {
  const isOwner = theme === "owner";
  return (
    <div className="flex flex-col items-center justify-center text-center py-12">
      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ${isOwner ? "bg-ownerGoldTint text-ownerGold" : "bg-gray-50 text-gray-400"}`}>
        {icon}
      </div>
      <h3 className="font-heading text-xl font-semibold text-[#0F2044] mt-4">
        {title}
      </h3>
      <p className="text-gray-500 text-sm mt-1">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

