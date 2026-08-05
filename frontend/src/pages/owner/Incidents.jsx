import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import OwnerLayout from "@/components/layout/OwnerLayout";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { AlertTriangle, Search, ChevronDown } from "lucide-react";
import SkeletonTable from "@/components/ui/SkeletonTable";
import EmptyState from "@/components/ui/EmptyState";
import { fmtDateTime } from "@/lib/time";

export default function OwnerIncidents() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [openDropdown, setOpenDropdown] = useState(null);

  useEffect(() => {
    // Expected to hit an owner-scoped endpoint
    api.get("/incidents")
      .then(r => setRows(Array.isArray(r.data) ? r.data : []))
      .catch(() => toast.error("Failed to load incidents"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest('.filter-dropdown-container')) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    return rows.filter(r => {
      const matchQ = !q || (r.description?.toLowerCase().includes(q.toLowerCase()) || r.plate?.toLowerCase().includes(q.toLowerCase()));
      const matchStatus = statusFilter === "all" ? true : r.status === statusFilter;
      return matchQ && matchStatus;
    });
  }, [rows, q, statusFilter]);

  return (
    <OwnerLayout title="Incidents">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold text-[#0F2044]">Incidents</h1>
        <p className="text-gray-500 text-sm">View damage reports and issues from your operations.</p>
      </div>

      <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden fade-in-up">
        <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex flex-wrap gap-4 items-center justify-between">
          <div className="relative w-full max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by description or plate..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm rounded-xl border border-gray-200 focus:border-[#1A3C6E] focus:ring-1 focus:ring-[#1A3C6E] outline-none"
            />
          </div>
        </div>

        {loading ? (
          <SkeletonTable rows={5} columns={5} />
        ) : filtered.length === 0 ? (
          <EmptyState theme="owner" icon={<AlertTriangle className="w-8 h-8" />} title="No Incidents" description="There are no incidents matching your criteria." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-[#0F2044]/[0.04] text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100">
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4">Car Plate</th>
                  <th className="px-6 py-4">Event</th>
                  <th className="px-6 py-4">Description</th>
                  <th className="px-6 py-4 relative filter-dropdown-container">
                    <span 
                      onClick={() => setOpenDropdown(openDropdown === 'status' ? null : 'status')}
                      className={`flex items-center gap-1 cursor-pointer select-none ${statusFilter !== "all" ? "text-[#1A3C6E] font-bold" : ""}`}
                    >
                      STATUS <ChevronDown className={`w-3 h-3 ${statusFilter !== "all" ? "text-[#1A3C6E]" : ""}`} />
                    </span>
                    {openDropdown === 'status' && (
                      <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg p-1 min-w-[140px] font-normal normal-case">
                        {["all", "open", "resolved"].map(opt => (
                          <div key={opt} onClick={() => { setStatusFilter(opt); setOpenDropdown(null); }} className="px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-gray-50 flex items-center gap-2 capitalize">
                            {statusFilter === opt ? <div className="w-2 h-2 rounded-full bg-[#1A3C6E]" /> : <div className="w-2 h-2" />}
                            {opt}
                          </div>
                        ))}
                      </div>
                    )}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(inc => (
                  <tr key={inc.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-gray-500">{fmtDateTime(inc.created_at)}</td>
                    <td className="px-6 py-4 font-mono font-bold text-[#0F2044]">{inc.plate || "—"}</td>
                    <td className="px-6 py-4 text-gray-600 max-w-[200px] truncate">{inc.event_name || "—"}</td>
                    <td className="px-6 py-4 text-gray-800 max-w-xs truncate">{inc.description}</td>
                    <td className="px-6 py-4">
                      {inc.status === "open" ? (
                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">Open</span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">Resolved</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </OwnerLayout>
  );
}
