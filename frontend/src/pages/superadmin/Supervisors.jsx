import { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import SuperLayout from "@/components/layout/SuperLayout";
import StatusBadge from "@/components/ui/StatusBadge";
import { Pagination } from "../../components/ui/Pagination";
import { api, decodeJwt } from "@/lib/api";
import { toast } from "sonner";
import { Search, Users, Shield, ChevronDown, Check, AlertTriangle, CheckCircle } from "lucide-react";
import SkeletonTable from "@/components/ui/SkeletonTable";
import EmptyState from "@/components/ui/EmptyState";

export default function Supervisors() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchRef = useRef(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [providerFilter, setProviderFilter] = useState("all");
  const [providers, setProviders] = useState([]);
  const nav = useNavigate();
  const [openDropdown, setOpenDropdown] = useState(null);
  const [page, setPage] = useState(1);
  
  const token = localStorage.getItem("superadmin_token");
  const user = token ? decodeJwt(token) : null;
  const isSuperadmin = user?.role === "superadmin";

  const load = async () => {
    try {
      const [resSups, resProvs] = await Promise.all([
        api.get("/supervisors"),
        isSuperadmin ? api.get("/providers") : Promise.resolve({ data: [] })
      ]);
      setRows(resSups.data);
      if (isSuperadmin) setProviders(resProvs.data);
    } catch (err) {
      toast.error("Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  useEffect(() => { setPage(1); }, [q, statusFilter, providerFilter]);

  const suggestions = useMemo(() => {
    if (!q || q.length < 1) return [];
    return rows
      .filter(r => r.name?.toLowerCase().includes(q.toLowerCase()) || r.email?.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 5);
  }, [rows, q]);

  const filtered = useMemo(() => rows.filter(r => { 
    const matchQ = !q || `${r.name} ${r.email} ${r.phone}`.toLowerCase().includes(q.toLowerCase()); 
    const matchStatus = statusFilter === "all" || (statusFilter === "active" ? r.is_active : !r.is_active); 
    const matchProvider = providerFilter === "all" || r.provider_id === providerFilter;
    return matchQ && matchStatus && matchProvider; 
  }), [rows, q, statusFilter, providerFilter]);

  const PAGE_SIZE = 25;
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <SuperLayout title="Supervisors">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold text-[#0F2044]">All Supervisors</h1>
        <p className="text-gray-500 text-sm">
          {isSuperadmin ? "Supervisors across every provider." : "Supervisors for your team."}
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-4 mb-5">
        <div className="relative flex-1 min-w-[200px]" ref={searchRef}>
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input 
            value={q} 
            onChange={(e) => { setQ(e.target.value); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            onKeyDown={(e) => { if (e.key === "Escape") setShowSuggestions(false); }}
            placeholder="Search by name, email or phone"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 outline-none focus:border-[#1A3C6E] text-sm" 
          />
          
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden">
              {suggestions.map(s => (
                <div key={s.id} onClick={() => { setQ(s.name); setShowSuggestions(false); }}
                     className="px-[14px] py-[10px] hover:bg-[#F9FAFB] cursor-pointer transition-colors border-b border-gray-50 last:border-0">
                  <div className="text-[#0F2044] font-bold text-sm">{s.name}</div>
                  <div className="text-[#9CA3AF] text-xs">{s.email}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        {isSuperadmin && (
          <div className="flex gap-2 mt-3"> 
            <select 
              value={providerFilter} 
              onChange={(e) => setProviderFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium bg-white outline-none focus:border-[#1A3C6E]"
            >
              <option value="all">All Providers</option>
              {providers.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {statusFilter !== "all" && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1A3C6E]/10 text-[#1A3C6E] text-xs font-semibold">
            Status: {statusFilter} <button onClick={() => setStatusFilter("all")}>×</button>
          </span>
        </div>
      )}

      {loading ? (
        <SkeletonTable rows={6} cols={5} />
      ) : (
        <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden">
          {filtered.length === 0 ? (
            <EmptyState
              icon={<Shield className="w-8 h-8 text-gray-300" />}
              title={q ? "No supervisors found" : "No supervisors yet"}
              subtitle={q ? `No supervisors matching "${q}"` : "Assigned supervisors will appear here once added."}
            />
          ) : (
            <div className="overflow-x-auto w-full max-w-full">
              <div className="overflow-x-auto w-full max-w-full">
                <table className="w-full text-sm min-w-[600px]">
                <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                  <tr>
                    <th className="text-left px-5 py-3">Name</th>
                    <th className="text-left px-5 py-3 hidden sm:table-cell">Email</th>
                    <th className="text-left px-5 py-3">Phone</th>
                    {isSuperadmin && <th className="text-left px-5 py-3">Provider</th>}
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
                <tbody className="divide-y divide-gray-100">
                  {paginated.map(s => (
                    <tr key={s.id} onClick={() => nav(`/superadmin/supervisors/${s.id}`)}
                        className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors group">
                      <td className="px-5 py-3 font-medium text-[#1A3C6E]">{s.name}</td>
                      <td className="px-5 py-3 text-gray-600 hidden sm:table-cell">{s.email}</td>
                      <td className="px-5 py-3 text-gray-600">{s.phone}</td>
                      {isSuperadmin && <td className="px-5 py-3 text-gray-600">{s.provider_name}</td>}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${(s.is_verified && s.is_active) ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                            {(s.is_verified && s.is_active) ? "Active" : "Inactive"}
                          </span>
                          {
  s.is_verified ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
      <CheckCircle className="w-3 h-3" /> Verified
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium">
      <AlertTriangle className="w-3 h-3" /> Unverified
    </span>
  )
}
                        </div>
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
                    <Pagination currentPage={page} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </SuperLayout>
  );
}
