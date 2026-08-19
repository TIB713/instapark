import { useEffect, useMemo, useState, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import SuperLayout from "@/components/layout/SuperLayout";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Search, CalendarClock, ChevronDown } from "lucide-react";
import SkeletonTable from "@/components/ui/SkeletonTable";
import EmptyState from "@/components/ui/EmptyState";

export default function Events() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [sortCol, setSortCol] = useState("date");
  const [sortDir, setSortDir] = useState("desc");
  const searchRef = useRef(null);
  const nav = useNavigate();
  const filter = params.get("filter") || "all";
  const [openDropdown, setOpenDropdown] = useState(null);
  const [page, setPage] = useState(1);

  const handleSort = (col) => {
    if (sortCol === col) {
      setSortDir(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  useEffect(() => {
    api.get("/events/all")
      .then(r => setRows(r.data))
      .catch(() => toast.error("Failed to load events"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowSuggestions(false);
        setActiveIndex(-1);
      }
      if (!e.target.closest('.filter-dropdown-container')) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => { setPage(1); }, [filter, q]);

  const suggestions = useMemo(() => {
    if (!q || q.length < 1) return [];
    return rows
      .filter(r => r.name?.toLowerCase().includes(q.toLowerCase()) || r.venue?.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 5);
  }, [rows, q]);

  const filtered = useMemo(() => rows.filter(r => { 
    const matchStatus = filter === "all" ? true : r.status === filter; 
    const matchQ = !q || `${r.name} ${r.provider_name} ${r.venue}`.toLowerCase().includes(q.toLowerCase()); 
    return matchStatus && matchQ; 
  }).sort((a, b) => {
    if (sortCol === "date") {
      return sortDir === "asc" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date);
    } else if (sortCol === "provider") {
      const pA = (a.provider_name || "").toLowerCase();
      const pB = (b.provider_name || "").toLowerCase();
      return sortDir === "asc" ? pA.localeCompare(pB) : pB.localeCompare(pA);
    }
    return 0;
  }), [rows, filter, q, sortCol, sortDir]);

  const PAGE_SIZE = 25;
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <SuperLayout title="Events">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold text-[#0F2044]">All Events</h1>
        <p className="text-gray-500 text-sm">Every event across every provider.</p>
      </div>

      <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-4 mb-4"> 
        <div className="relative flex-1 min-w-[200px]" ref={searchRef}> 
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /> 
          <input 
            data-testid="event-search-input" 
            value={q} 
            onChange={(e) => { setQ(e.target.value); setShowSuggestions(true); setActiveIndex(-1); }}
            onFocus={() => setShowSuggestions(true)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setShowSuggestions(false);
                setActiveIndex(-1);
              } else if (e.key === "ArrowDown") {
                if (showSuggestions) {
                  e.preventDefault();
                  setActiveIndex(prev => Math.min(prev + 1, suggestions.length - 1));
                }
              } else if (e.key === "ArrowUp") {
                if (showSuggestions) {
                  e.preventDefault();
                  setActiveIndex(prev => Math.max(prev - 1, -1));
                }
              } else if (e.key === "Enter") {
                if (showSuggestions && activeIndex >= 0 && activeIndex < suggestions.length) {
                  setQ(suggestions[activeIndex].name);
                  setShowSuggestions(false);
                  setActiveIndex(-1);
                } else {
                  setShowSuggestions(false);
                  setActiveIndex(-1);
                }
              }
            }}
            placeholder="Search by event name, provider, or venue" 
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 outline-none focus:border-[#1A3C6E]" 
          /> 
          
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden">
              {suggestions.map((s, index) => (
                <div key={s.id} id={`suggestion-${index}`} onClick={() => { setQ(s.name); setShowSuggestions(false); setActiveIndex(-1); }}
                     className={`px-[14px] py-[10px] hover:bg-[#F9FAFB] cursor-pointer transition-colors border-b border-gray-50 last:border-0 ${activeIndex === index ? 'bg-[#F0F4FF]' : ''}`}>
                  <div className="text-[#0F2044] font-bold text-sm">{s.name}</div>
                  <div className="text-[#9CA3AF] text-xs">{s.venue} • {s.date}</div>
                </div>
              ))}
            </div>
          )}
        </div> 
      </div>

      {filter !== "all" && (
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1A3C6E]/10 text-[#1A3C6E] text-xs font-semibold">
            Status: {filter} <button onClick={() => setParams({})}>×</button>
          </span>
        </div>
      )}
      {loading ? (
        <SkeletonTable rows={6} cols={6} />
      ) : (
        <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden">
          {filtered.length === 0 ? (
            <EmptyState
              icon={<CalendarClock className="w-8 h-8" />}
              title={q ? "No events found" : "No events yet"}
              subtitle={
                q
                  ? `No events found matching "${q}"`
                  : "Created events across providers will appear here."
              }
            />
          ) : (
            <div className="overflow-x-auto w-full max-w-full">
              <table className="w-full text-sm min-w-[600px]" data-testid="events-table">
              <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                <tr>
                  <th className="text-left px-5 py-3">Name</th>
                  <th 
                    onClick={() => handleSort("provider")} 
                    className={`text-left px-5 py-3 cursor-pointer select-none ${sortCol === "provider" ? "text-[#1A3C6E] font-bold" : ""}`}
                  >
                    Provider {sortCol === "provider" ? (sortDir === "asc" ? "↑" : "↓") : <span className="opacity-30">↕</span>}
                  </th>
                  <th 
                    onClick={() => handleSort("date")} 
                    className={`text-left px-5 py-3 cursor-pointer select-none ${sortCol === "date" ? "text-[#1A3C6E] font-bold" : ""}`}
                  >
                    Date {sortCol === "date" ? (sortDir === "asc" ? "↑" : "↓") : <span className="opacity-30">↕</span>}
                  </th>
                  <th className="text-left px-5 py-3 hidden sm:table-cell">Venue</th>
                  <th className="text-left px-5 py-3 relative filter-dropdown-container">
                    <span 
                      onClick={() => setOpenDropdown(openDropdown === 'status' ? null : 'status')}
                      className={`flex items-center gap-1 cursor-pointer select-none ${filter !== "all" ? "text-[#1A3C6E] font-bold" : ""}`}
                    >
                      STATUS <ChevronDown className={`w-3 h-3 ${filter !== "all" ? "text-[#1A3C6E]" : ""}`} />
                    </span>
                    {openDropdown === 'status' && (
                      <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg p-1 min-w-[140px] font-normal normal-case">
                        {["all", "active", "closed"].map(opt => (
                          <div key={opt} onClick={() => { setParams(opt === "all" ? {} : { filter: opt }); setOpenDropdown(null); }} className="px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-gray-50 flex items-center gap-2 capitalize">
                            {filter === opt ? <div className="w-2 h-2 rounded-full bg-[#1A3C6E]" /> : <div className="w-2 h-2" />}
                            {opt}
                          </div>
                        ))}
                      </div>
                    )}
                  </th>
                  <th className="text-left px-5 py-3">Capacity</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map(e => (
                  <tr key={e.id} onClick={() => nav(`/superadmin/events/${e.id}`)}
                      className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors">
                    <td className="px-5 py-3 font-medium">{e.name}</td>
                    <td className="px-5 py-3 text-gray-600">{e.provider_name}</td>
                    <td className="px-5 py-3 text-gray-600">{e.date}</td>
                    <td className="px-5 py-3 text-gray-600 hidden sm:table-cell">{e.venue}</td>
                    <td className="px-5 py-3">
                      {e.status === "active" ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 inline-flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block pulse-dot" />
                          Active
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">
                          Closed
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {(() => {
                        const cars = e.occupied_slots || 0;
                        const max = Number(e.max_cars) || 0;
                        const rawPct = max > 0 ? (cars / max) * 100 : 0;
                        const pct = Math.max(0, Math.min(100, rawPct));
                        const fillClass =
                          pct >= 100
                            ? "bg-red-500"
                            : pct >= 70
                            ? "bg-amber-500"
                            : "bg-emerald-500";
                        return (
                          <div className="min-w-[130px]">
                            <div className="flex flex-col gap-0.5">
                              <div className="text-xs font-bold text-gray-700">
                                {cars} / {max}
                              </div>
                              {e.carried_forward_count > 0 && (
                                <div className="text-[10px] text-amber-600 font-semibold leading-tight">
                                  {e.carried_forward_count} held over from yesterday
                                </div>
                              )}
                            </div>
                            <div className="mt-1.5 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${fillClass}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })()}
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
