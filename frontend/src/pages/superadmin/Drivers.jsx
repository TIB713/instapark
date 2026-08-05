import { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import SuperLayout from "@/components/layout/SuperLayout";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Search, Users, ChevronDown } from "lucide-react";
import SkeletonTable from "@/components/ui/SkeletonTable";
import EmptyState from "@/components/ui/EmptyState";

export default function Drivers() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchRef = useRef(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const nav = useNavigate();
  const [openDropdown, setOpenDropdown] = useState(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    api.get("/drivers")
      .then(r => setRows(r.data))
      .catch(() => toast.error("Failed to load drivers"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
      if (!e.target.closest('.filter-dropdown-container')) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => { setPage(1); }, [q, statusFilter]);

  const suggestions = useMemo(() => {
    if (!q || q.length < 1) return [];
    return rows
      .filter(r => r.name?.toLowerCase().includes(q.toLowerCase()) || r.employee_id?.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 5);
  }, [rows, q]);

  const filtered = useMemo(() => rows.filter(r => { 
    const matchQ = !q || `${r.name} ${r.employee_id}`.toLowerCase().includes(q.toLowerCase()); 
    const matchStatus = statusFilter === "all" || (statusFilter === "active" ? r.is_active : !r.is_active); 
    return matchQ && matchStatus; 
  }), [rows, q, statusFilter]);

  const PAGE_SIZE = 25;
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <SuperLayout title="Drivers">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold text-[#0F2044]">All Drivers</h1>
        <p className="text-gray-500 text-sm">Drivers across every provider.</p>
      </div>
      <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-4 mb-5">
        <div className="relative flex-1 min-w-[200px]" ref={searchRef}>
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input data-testid="driver-search-input" value={q} 
                 onChange={(e) => { setQ(e.target.value); setShowSuggestions(true); }}
                 onFocus={() => setShowSuggestions(true)}
                 onKeyDown={(e) => { if (e.key === "Escape") setShowSuggestions(false); }}
                 placeholder="Search by name or employee ID"
                 className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 outline-none focus:border-[#1A3C6E]" />
          
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden">
              {suggestions.map(s => (
                <div key={s.id} onClick={() => { setQ(s.name); setShowSuggestions(false); }}
                     className="px-[14px] py-[10px] hover:bg-[#F9FAFB] cursor-pointer transition-colors border-b border-gray-50 last:border-0">
                  <div className="text-[#0F2044] font-bold text-sm">{s.name}</div>
                  <div className="text-[#9CA3AF] text-xs">{s.employee_id}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {statusFilter !== "all" && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1A3C6E]/10 text-[#1A3C6E] text-xs font-semibold">
            Status: {statusFilter} <button onClick={() => setStatusFilter("all")}>×</button>
          </span>
        </div>
      )}
      {loading ? (
        <SkeletonTable rows={6} cols={4} />
      ) : (
        <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden">
          {filtered.length === 0 ? (
            <EmptyState
              icon={<Users className="w-8 h-8" />}
              title={q ? "No drivers found" : "No drivers yet"}
              subtitle={
                q
                  ? `No drivers found matching "${q}"`
                  : "Assigned drivers will appear here once added."
              }
            />
          ) : (
            <div className="overflow-x-auto w-full max-w-full">
              <table className="w-full text-sm min-w-[600px]" data-testid="drivers-table">
              <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                <tr>
                  <th className="text-left px-5 py-3">Name</th>
                  <th className="text-left px-5 py-3 hidden sm:table-cell">Employee ID</th>
                  <th className="text-left px-5 py-3">Provider</th>
                  <th className="text-left px-5 py-3 relative filter-dropdown-container">
                    <span 
                      onClick={() => setOpenDropdown(openDropdown === 'status' ? null : 'status')}
                      className={`flex items-center gap-1 cursor-pointer select-none ${statusFilter !== "all" ? "text-[#1A3C6E] font-bold" : ""}`}
                    >
                      STATUS <ChevronDown className={`w-3 h-3 ${statusFilter !== "all" ? "text-[#1A3C6E]" : ""}`} />
                    </span>
                    {openDropdown === 'status' && (
                      <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg p-1 min-w-[140px] font-normal normal-case">
                        {["all", "active", "inactive"].map(opt => (
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
              <tbody>
                {paginated.map(d => (
                  <tr key={d.id} onClick={() => nav(`/superadmin/drivers/${d.id}`)}
                      className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors">
                    <td className="px-5 py-3 font-medium">{d.name}</td>
                    <td className="px-5 py-3 font-mono text-gray-600 hidden sm:table-cell">{d.employee_id}</td>
                    <td className="px-5 py-3 text-gray-600">{d.provider_name}</td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${d.is_active ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{d.is_active ? "Active" : "Inactive"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > PAGE_SIZE && (
              <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between">
                <span className="text-sm text-gray-400">
                  Showing {Math.min((page - 1) * PAGE_SIZE + 1, filtered.length)}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
                </span>
                <div className="flex items-center gap-2">
                  <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Prev</button>
                  <span className="px-3 py-1.5 rounded-lg bg-[#0F2044] text-white text-sm font-bold">{page}</span>
                  <button disabled={page * PAGE_SIZE >= filtered.length} onClick={() => setPage(p => p + 1)}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Next</button>
                </div>
              </div>
            )}
            </div>
          )}
        </div>
      )}
    </SuperLayout>
  );
}
