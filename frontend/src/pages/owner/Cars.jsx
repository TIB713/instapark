import { useEffect, useMemo, useState, useRef } from "react"; 
import { useNavigate, useSearchParams } from "react-router-dom"; 
import OwnerLayout from "@/components/layout/OwnerLayout"; 
import { api } from "@/lib/api"; 
import { fmtDateTime } from "@/lib/time";
import { toast } from "sonner"; 
import { Search, Car, ChevronDown } from "lucide-react"; 
import SkeletonTable from "@/components/ui/SkeletonTable";
import EmptyState from "@/components/ui/EmptyState";
 
export default function OwnerCars() { 
  const [rows, setRows] = useState([]); 
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(""); 
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchRef = useRef(null);
  const [filter, setFilter] = useState("all"); 
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 100;
  const nav = useNavigate(); 
  const [searchParams, setSearchParams] = useSearchParams();
  const [dateFilter, setDateFilter] = useState(searchParams.get("date") || "");
  const [openDropdown, setOpenDropdown] = useState(null);

  useEffect(() => { setDateFilter(searchParams.get("date") || ""); }, [searchParams]);

  const fetchCars = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/cars", {
        params: { skip: page * PAGE_SIZE, limit: PAGE_SIZE, plate: q || undefined },
      });
      setRows(Array.isArray(data) ? data : []);
    } catch {
      toast.error("Failed to load cars");
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchCars(); }, [page, q]); 
 
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

  const suggestions = useMemo(() => {
    if (!q || q.length < 1) return [];
    return rows
      .filter(r => r.plate?.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 5);
  }, [rows, q]);

  const filtered = useMemo(() => rows.filter(r => { 
    const matchQ = !q || `${r.plate} ${r.make} ${r.color}`.toLowerCase().includes(q.toLowerCase()); 
    const matchFilter = 
      filter === "all" ? true : 
      filter === "active" ? r.has_active : 
      filter === "repeat" ? r.total_visits > 1 : true; 
    const matchDate = !dateFilter || (r.last_seen && r.last_seen.startsWith(dateFilter));
    return matchQ && matchFilter && matchDate; 
  }), [rows, q, filter, dateFilter]); 
 
  return ( 
    <OwnerLayout title="Cars"> 
      <div className="mb-6"> 
        <h1 className="font-heading text-2xl font-bold text-[#0F2044]">Cars</h1> 
        <p className="text-gray-500 text-sm">Every vehicle that has visited your hotels.</p> 
      </div> 
 
      {/* Search */} 
      <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-4 mb-4"> 
        <div className="relative flex-1 min-w-[200px]" ref={searchRef}> 
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /> 
          <input 
            data-testid="car-search-input" 
            value={q} 
            onChange={e => { setQ(e.target.value); setShowSuggestions(true); }} 
            onFocus={() => setShowSuggestions(true)}
            onKeyDown={(e) => { if (e.key === "Escape") setShowSuggestions(false); }}
            placeholder="Search by plate number, make, or color…" 
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 outline-none focus:border-[#1A3C6E]" 
          /> 
          
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden">
              {suggestions.map(s => (
                <div key={s.plate} onClick={() => { setQ(s.plate); setShowSuggestions(false); }}
                     className="px-[14px] py-[10px] hover:bg-[#F9FAFB] cursor-pointer transition-colors border-b border-gray-50 last:border-0">
                  <div className="text-[#0F2044] font-bold text-sm">{s.plate}</div>
                  <div className="text-[#9CA3AF] text-xs">{s.make} • {s.color}</div>
                </div>
              ))}
            </div>
          )}
        </div> 
      </div> 
 
      {(filter !== "all" || dateFilter) && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {filter !== "all" && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1A3C6E]/10 text-[#1A3C6E] text-xs font-semibold">
              Status: {filter === "active" ? "Currently Active" : "Repeat Visitors"} <button onClick={() => setFilter("all")}>×</button>
            </span>
          )}
          {dateFilter && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1A3C6E]/10 text-[#1A3C6E] text-xs font-semibold">
              Date: {dateFilter} <button onClick={() => { setDateFilter(""); setSearchParams({}); }}>×</button>
            </span>
          )}
        </div>
      )}
      {/* Table */} 
      {loading ? (
        <SkeletonTable rows={6} cols={6} />
      ) : (
        <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden"> 
          {filtered.length === 0 ? (
            <EmptyState
              icon={<Car className="w-8 h-8" />}
              title={q ? "No cars found" : "No cars yet"}
              subtitle={
                q
                  ? `No cars found matching "${q}"`
                  : "Every registered vehicle will appear here."
              }
            />
          ) : (
            <div className="overflow-x-auto w-full max-w-full">
              <table className="w-full text-sm min-w-[600px]" data-testid="cars-table"> 
              <thead className="bg-gray-50 text-gray-500 uppercase text-xs"> 
                <tr> 
                  <th className="text-left px-5 py-3">Plate</th> 
                  <th className="text-left px-5 py-3 hidden sm:table-cell">Make / Color</th> 
                  <th className="text-left px-5 py-3">Total Visits</th> 
                  <th className="text-left px-5 py-3">Last Event</th> 
                  <th className="text-left px-5 py-3 relative filter-dropdown-container">
                    <span 
                      onClick={() => setOpenDropdown(openDropdown === 'date' ? null : 'date')}
                      className={`flex items-center gap-1 cursor-pointer select-none ${dateFilter ? "text-[#1A3C6E] font-bold" : ""}`}
                    >
                      LAST SEEN <ChevronDown className={`w-3 h-3 ${dateFilter ? "text-[#1A3C6E]" : ""}`} />
                    </span>
                    {openDropdown === 'date' && (
                      <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg p-2 min-w-[160px] font-normal normal-case">
                        <input 
                          type="date" 
                          value={dateFilter}
                          onChange={(e) => { setDateFilter(e.target.value); setOpenDropdown(null); }}
                          className="w-full px-2 py-1 text-sm rounded border border-gray-200 outline-none"
                        />
                        <button onClick={() => { setDateFilter(""); setSearchParams({}); setOpenDropdown(null); }} className="mt-2 w-full text-center text-xs text-red-500 hover:text-red-700">Clear</button>
                      </div>
                    )}
                  </th>
                  <th className="text-left px-5 py-3 relative filter-dropdown-container">
                    <span 
                      onClick={() => setOpenDropdown(openDropdown === 'status' ? null : 'status')}
                      className={`flex items-center gap-1 cursor-pointer select-none ${filter !== "all" ? "text-[#1A3C6E] font-bold" : ""}`}
                    >
                      STATUS <ChevronDown className={`w-3 h-3 ${filter !== "all" ? "text-[#1A3C6E]" : ""}`} />
                    </span>
                    {openDropdown === 'status' && (
                      <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg p-1 min-w-[140px] font-normal normal-case">
                        {[
                          { key: "all", label: "All" }, 
                          { key: "active", label: "Currently Active" }, 
                          { key: "repeat", label: "Repeat Visitors" }
                        ].map(opt => (
                          <div key={opt.key} onClick={() => { setFilter(opt.key); setOpenDropdown(null); }} className="px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-gray-50 flex items-center gap-2">
                            {filter === opt.key ? <div className="w-2 h-2 rounded-full bg-[#1A3C6E]" /> : <div className="w-2 h-2" />}
                            {opt.label}
                          </div>
                        ))}
                      </div>
                    )}
                  </th> 
                </tr> 
              </thead> 
              <tbody> 
                {filtered.map(r => ( 
                  <tr key={r.plate} 
                    onClick={() => nav(`/provider/cars/${encodeURIComponent(r.plate)}`)}
                    className="border-t border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer"> 
                    <td className="px-5 py-3"> 
                      <span className="font-mono font-bold text-[#0F2044] text-base tracking-wider">{r.plate}</span> 
                    </td> 
                    <td className="px-5 py-3 text-gray-600 hidden sm:table-cell">{r.make} / {r.color}</td> 
                    <td className="px-5 py-3"> 
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${r.total_visits > 1 ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-600"}`}> 
                        {r.total_visits} {r.total_visits === 1 ? "visit" : "visits"} 
                      </span> 
                    </td> 
                    <td className="px-5 py-3 text-gray-600 max-w-[180px] truncate">{r.last_event_name}</td> 
                    <td className="px-5 py-3 text-gray-500 text-xs font-mono"> 
                      {r.last_seen ? fmtDateTime(r.last_seen) : "—"} 
                    </td> 
                    <td className="px-5 py-3"> 
                      {r.has_active 
                        ? <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 flex items-center gap-1 w-fit"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />Active</span> 
                        : <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">Past</span> 
                      } 
                    </td> 
                  </tr> 
                ))} 
              </tbody> 
            </table>
            </div>
          )}
        </div>
      )} 
 
      {/* Pagination */}
      {!loading && (
        <div className="flex flex-wrap items-center gap-3 justify-between mt-4">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium disabled:opacity-40 hover:bg-gray-50 transition"
          >
            Prev
          </button>
          <span className="text-xs text-gray-400">Page {page + 1}</span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={rows.length < PAGE_SIZE}
            className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium disabled:opacity-40 hover:bg-gray-50 transition"
          >
            Next
          </button>
        </div>
      )}

      {/* Summary footer */} 
      {rows.length > 0 && ( 
        <p className="text-xs text-gray-400 mt-3 text-right"> 
          Showing {filtered.length} of {rows.length} unique plates 
        </p> 
      )} 
    </OwnerLayout> 
  ); 
}
