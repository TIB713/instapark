import { useEffect, useMemo, useState, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import OwnerLayout from "@/components/layout/OwnerLayout";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Search, CalendarClock, ChevronDown, Plus, X, Trash2 } from "lucide-react";
import SkeletonTable from "@/components/ui/SkeletonTable";
import EmptyState from "@/components/ui/EmptyState";

import { useScrollToFirstError } from "../../hooks/useScrollToFirstError";

export default function OwnerEvents() {
  const eventFieldRefs = useRef({});
  const scrollToFirstEventError = useScrollToFirstError(["hotel_id", "name", "host_email", "date", "end_date", "venue", "start_time", "end_time", "max_cars"], eventFieldRefs);
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
  const hotelIdFilter = params.get("hotel_id") || null;
  const [openDropdown, setOpenDropdown] = useState(null);
  const [page, setPage] = useState(1);

  const [hotels, setHotels] = useState([]);
  const [showEventModal, setShowEventModal] = useState(false);
  const [eventErrors, setEventErrors] = useState({});
  const [eventForm, setEventForm] = useState({
    hotel_id: "",
    name: "", date: "", end_date: "", venue: "", max_cars: 50,
    gates: ["Main Gate"], start_time: "", end_time: "",
    zones: [{ name: "A", slots: 20 }],
    host_name: "", host_email: "", allow_instant_park: false
  });
  const totalEventSlots = eventForm.zones.reduce((sum, z) => sum + (parseInt(z.slots) || 0), 0);

  const handleSort = (col) => {
    if (sortCol === col) {
      setSortDir(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  useEffect(() => {
    // /events is automatically scoped by the backend to the user's provider_id
    api.get("/events")
      .then(r => setRows(Array.isArray(r.data) ? r.data : []))
      .catch(() => toast.error("Failed to load events"))
      .finally(() => setLoading(false));

    api.get("/hotels")
      .then(r => setHotels(Array.isArray(r.data) ? r.data : []))
      .catch(() => {});
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

  useEffect(() => {
    if (!showEventModal) return;
    const handleEsc = (e) => {
      if (e.key === "Escape") {
        setShowEventModal(false);
      }
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [showEventModal]);

  useEffect(() => { setPage(1); }, [filter, q, hotelIdFilter]);

  const validateEvent = () => {
    const errs = {};
    if (!eventForm.name?.trim()) errs.name = "Event name is required";
    if (eventForm.host_email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(eventForm.host_email.trim())) errs.host_email = "Please enter a valid email address";
    if (!eventForm.date) errs.date = "Start date is required";
    if (!eventForm.end_date) errs.end_date = "End date is required";
    else if (eventForm.date && eventForm.end_date < eventForm.date) errs.end_date = "End date cannot be before start date";
    if (!eventForm.venue?.trim()) errs.venue = "Venue is required";
    if (!eventForm.start_time) errs.start_time = "Start time is required";
    if (!eventForm.end_time) errs.end_time = "End time is required";
    if (!eventForm.max_cars || eventForm.max_cars < 1) errs.max_cars = "Max cars must be at least 1";
    return errs;
  };

  const handleCreateEvent = async (e) => {
    e.preventDefault();
    const errs = validateEvent();
    setEventErrors(errs);
    if (Object.keys(errs).length > 0) {
      scrollToFirstEventError(errs);
      return;
    }
    if (totalEventSlots > eventForm.max_cars) {
      toast.error(`Total zone slots (${totalEventSlots}) cannot exceed max cars (${eventForm.max_cars}). Reduce zone slots.`);
      return;
    }
    try {
      const body = {
        ...eventForm,
        event_type: "hotel_special",
        gates: eventForm.gates.filter(g => g.trim()),
        zones: eventForm.zones.filter(z => z.name.trim())
      };
      const res = await api.post(`/hotels/${eventForm.hotel_id}/events`, body);
      if (eventForm.host_name?.trim() && eventForm.host_email?.trim()) {
        try {
          await api.patch(`/events/${res.data.id}/host`, {
            host_name: eventForm.host_name.trim(),
            host_email: eventForm.host_email.trim()
          });
          toast.success("Special event created and host invited!");
        } catch (err) {
          toast.error("Event created, but host invite failed to send.");
        }
      } else {
        toast.success("Special event created!");
      }
      setShowEventModal(false);
      setEventForm({ hotel_id: "", name: "", date: "", end_date: "", venue: "", max_cars: 50, gates: ["Main Gate"], start_time: "", end_time: "", zones: [{ name: "A", slots: 20 }], host_name: "", host_email: "", allow_instant_park: false });
      
      // Refresh events
      api.get("/events").then(r => setRows(Array.isArray(r.data) ? r.data : []));
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to create event");
    }
  };

  const suggestions = useMemo(() => {
    if (!q || q.length < 1) return [];
    return rows
      .filter(r => r.name?.toLowerCase().includes(q.toLowerCase()) || r.venue?.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 5);
  }, [rows, q]);

  const filtered = useMemo(() => rows.filter(r => { 
    const matchStatus = filter === "all" ? true : r.status === filter;
    const matchHotel = !hotelIdFilter || r.hotel_id === hotelIdFilter;
    const matchQ = !q || `${r.name} ${r.venue}`.toLowerCase().includes(q.toLowerCase()); 
    return matchStatus && matchHotel && matchQ; 
  }).sort((a, b) => {
    if (sortCol === "date") {
      return sortDir === "asc" ? (a.date || "").localeCompare(b.date || "") : (b.date || "").localeCompare(a.date || "");
    }
    return 0;
  }), [rows, filter, hotelIdFilter, q, sortCol, sortDir]);

  const PAGE_SIZE = 25;
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <OwnerLayout title="Events">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-[#0F2044]">Events</h1>
          <p className="text-gray-500 text-sm">View all current and past events.</p>
        </div>
        <button
          onClick={() => setShowEventModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[#0F2044] text-white rounded-xl text-sm font-bold hover:bg-[#1A3C6E] transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" /> Add Event
        </button>
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
            placeholder="Search by event name or venue" 
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 outline-none focus:border-[#1A3C6E]" 
          /> 
          
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden">
              {suggestions.map((s, index) => (
                <div key={s.id} onClick={() => { setQ(s.name); setShowSuggestions(false); setActiveIndex(-1); }}
                     className={`px-[14px] py-[10px] hover:bg-[#F9FAFB] cursor-pointer transition-colors border-b border-gray-50 last:border-0 ${activeIndex === index ? 'bg-[#F0F4FF]' : ''}`}>
                  <div className="text-[#0F2044] font-bold text-sm">{s.name}</div>
                  <div className="text-[#9CA3AF] text-xs">{s.venue} • {s.date}</div>
                </div>
              ))}
            </div>
          )}
        </div> 
      </div>

      {(filter !== "all" || hotelIdFilter) && (
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          {filter !== "all" && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1A3C6E]/10 text-[#1A3C6E] text-xs font-semibold">
              Status: {filter} <button onClick={() => { const p = new URLSearchParams(params); p.delete("filter"); setParams(p); }}>×</button>
            </span>
          )}
          {hotelIdFilter && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1A3C6E]/10 text-[#1A3C6E] text-xs font-semibold">
              Hotel: Filtered <button onClick={() => { const p = new URLSearchParams(params); p.delete("hotel_id"); setParams(p); }}>×</button>
            </span>
          )}
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
                  : "Events assigned to your account will appear here."
              }
            />
          ) : (
            <div className="overflow-x-auto w-full max-w-full">
              <table className="w-full text-sm min-w-[600px]" data-testid="events-table">
              <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                <tr>
                  <th className="text-left px-5 py-3">Name</th>
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
                          <div key={opt} onClick={() => { const p = new URLSearchParams(params); if(opt==="all") p.delete("filter"); else p.set("filter", opt); setParams(p); setOpenDropdown(null); }} className="px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-gray-50 flex items-center gap-2 capitalize">
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
                  <tr key={e.id} onClick={() => nav(`/provider/events/${e.id}`)}
                      className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors">
                    <td className="px-5 py-3 font-medium">{e.name}</td>
                    <td className="px-5 py-3 text-gray-600">{e.date || "—"}</td>
                    <td className="px-5 py-3 text-gray-600 hidden sm:table-cell">{e.venue || "—"}</td>
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

      {showEventModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 border-b border-gray-100 bg-[#0F2044]">
              <h3 className="font-heading text-xl font-bold text-white">Create Event</h3>
              <button onClick={() => setShowEventModal(false)} className="p-2 hover:bg-white/10 rounded-xl text-white/70 transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateEvent} className="p-6 space-y-4 overflow-y-auto max-h-[70vh]">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Hotel (Optional)</label>
                  <select ref={el => { if (eventFieldRefs.current) eventFieldRefs.current.hotel_id = el; }} 
                    value={eventForm.hotel_id}
                    onChange={e => { setEventForm(prev => ({ ...prev, hotel_id: e.target.value})); if (eventErrors.hotel_id) setEventErrors(prev => ({ ...prev, hotel_id: undefined })); }}
                    className={`w-full px-4 py-2 rounded-xl border ${eventErrors.hotel_id ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8] bg-white`}
                  >
                    <option value="">Select a hotel</option>
                    {hotels.map(h => (
                      <option key={h.id} value={h.id}>{h.name}</option>
                    ))}
                  </select>
                  { eventErrors.hotel_id && <p className="text-[11px] text-red-500 mt-1 font-medium">* {eventErrors.hotel_id}</p> }
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Event Name <span className="text-red-500">*</span></label>
                  <input ref={el => { if (eventFieldRefs.current) eventFieldRefs.current.name = el; }}  type="text" value={eventForm.name}
                    onChange={e => { setEventForm(prev => ({ ...prev, name: e.target.value})); if (eventErrors.name) setEventErrors(prev => ({ ...prev, name: undefined })); }}
                    className={`w-full px-4 py-2 rounded-xl border ${eventErrors.name ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`}
                    placeholder="e.g. New Year Gala" />
                  { eventErrors.name && <p className="text-[11px] text-red-500 mt-1 font-medium">* {eventErrors.name}</p> }
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Host Name (Optional)</label>
                  <input type="text" value={eventForm.host_name}
                    onChange={e => { setEventForm(prev => ({ ...prev, host_name: e.target.value})); if (eventErrors.host_name) setEventErrors(prev => ({ ...prev, host_name: undefined })); }}
                    className={`w-full px-4 py-2 rounded-xl border ${eventErrors.host_name ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`}
                    placeholder="e.g. John Doe" />
                  { eventErrors.host_name && <p className="text-[11px] text-red-500 mt-1 font-medium">* {eventErrors.host_name}</p> }
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Host Email (Optional)</label>
                  <input ref={el => { if (eventFieldRefs.current) eventFieldRefs.current.host_email = el; }}  type="email" value={eventForm.host_email}
                    onChange={e => { setEventForm(prev => ({ ...prev, host_email: e.target.value})); if (eventErrors.host_email) setEventErrors(prev => ({ ...prev, host_email: undefined })); }}
                    className={`w-full px-4 py-2 rounded-xl border ${eventErrors.host_email ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`}
                    placeholder="e.g. host@example.com" />
                  { eventErrors.host_email && <p className="text-[11px] text-red-500 mt-1 font-medium">* {eventErrors.host_email}</p> }
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Start Date <span className="text-red-500">*</span></label>
                  <input ref={el => { if (eventFieldRefs.current) eventFieldRefs.current.date = el; }}  type="date" value={eventForm.date}
                    onChange={e => { setEventForm(prev => ({ ...prev, date: e.target.value})); if (eventErrors.date) setEventErrors(prev => ({ ...prev, date: undefined })); }}
                    className={`w-full px-4 py-2 rounded-xl border ${eventErrors.date ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`} />
                  { eventErrors.date && <p className="text-[11px] text-red-500 mt-1 font-medium">* {eventErrors.date}</p> }
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">End Date <span className="text-red-500">*</span></label>
                  <input ref={el => { if (eventFieldRefs.current) eventFieldRefs.current.end_date = el; }}  type="date" value={eventForm.end_date}
                    onChange={e => { setEventForm(prev => ({ ...prev, end_date: e.target.value})); if (eventErrors.end_date) setEventErrors(prev => ({ ...prev, end_date: undefined })); }}
                    className={`w-full px-4 py-2 rounded-xl border ${eventErrors.end_date ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`} />
                  { eventErrors.end_date && <p className="text-[11px] text-red-500 mt-1 font-medium">* {eventErrors.end_date}</p> }
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Start Time <span className="text-red-500">*</span></label>
                  <input ref={el => { if (eventFieldRefs.current) eventFieldRefs.current.start_time = el; }}  type="time" value={eventForm.start_time}
                    onChange={e => { setEventForm(prev => ({ ...prev, start_time: e.target.value})); if (eventErrors.start_time) setEventErrors(prev => ({ ...prev, start_time: undefined })); }}
                    className={`w-full px-4 py-2 rounded-xl border ${eventErrors.start_time ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`} />
                  { eventErrors.start_time && <p className="text-[11px] text-red-500 mt-1 font-medium">* {eventErrors.start_time}</p> }
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">End Time <span className="text-red-500">*</span></label>
                  <input ref={el => { if (eventFieldRefs.current) eventFieldRefs.current.end_time = el; }}  type="time" value={eventForm.end_time}
                    onChange={e => { setEventForm(prev => ({ ...prev, end_time: e.target.value})); if (eventErrors.end_time) setEventErrors(prev => ({ ...prev, end_time: undefined })); }}
                    className={`w-full px-4 py-2 rounded-xl border ${eventErrors.end_time ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`} />
                  { eventErrors.end_time && <p className="text-[11px] text-red-500 mt-1 font-medium">* {eventErrors.end_time}</p> }
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Max Cars <span className="text-red-500">*</span></label>
                  <input ref={el => { if (eventFieldRefs.current) eventFieldRefs.current.max_cars = el; }}  type="number" min="1" value={eventForm.max_cars}
                    onChange={e => { setEventForm(prev => ({ ...prev, max_cars: parseInt(e.target.value) || 0})); if (eventErrors.max_cars) setEventErrors(prev => ({ ...prev, max_cars: undefined })); }}
                    className={`w-full px-4 py-2 rounded-xl border ${eventErrors.max_cars ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`} />
                  { eventErrors.max_cars && <p className="text-[11px] text-red-500 mt-1 font-medium">* {eventErrors.max_cars}</p> }
                </div>
                <div className="flex items-center gap-2 mt-4 sm:col-span-2">
                  <input type="checkbox" id="allow_instant_park_event" checked={eventForm.allow_instant_park}
                         onChange={(e) => setEventForm(prev => ({ ...prev, allow_instant_park: e.target.checked }))}
                         className="w-4 h-4 text-[#0F2044] bg-gray-100 border-gray-300 rounded focus:ring-[#0F2044]" />
                  <label htmlFor="allow_instant_park_event" className="text-xs font-semibold text-gray-600 uppercase cursor-pointer">
                    Allow Instant Park for this event
                  </label>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Gates</label>
                  <div className="space-y-2">
                    {eventForm.gates.map((gate, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={gate}
                          onChange={e => {
                            const newGates = [...eventForm.gates];
                            newGates[i] = e.target.value;
                            setEventForm({ ...eventForm, gates: newGates });
                          }}
                          placeholder="Gate name"
                          className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]"
                        />
                        {eventForm.gates.length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              const newGates = eventForm.gates.filter((_, idx) => idx !== i);
                              setEventForm({ ...eventForm, gates: newGates });
                            }}
                            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setEventForm({ ...eventForm, gates: [...eventForm.gates, ""] })}
                      className="text-xs font-bold text-[#1D4ED8] hover:text-[#1e40af] flex items-center gap-1 mt-1"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Gate
                    </button>
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Venue</label>
                  <input ref={el => { if (eventFieldRefs.current) eventFieldRefs.current.venue = el; }}  type="text" value={eventForm.venue}
                    onChange={e => { setEventForm(prev => ({ ...prev, venue: e.target.value})); if (eventErrors.venue) setEventErrors(prev => ({ ...prev, venue: undefined })); }}
                    className={`w-full px-4 py-2 rounded-xl border ${eventErrors.venue ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`}
                    placeholder="Venue name or location" />
                  { eventErrors.venue && <p className="text-[11px] text-red-500 mt-1 font-medium">* {eventErrors.venue}</p> }
                </div>
              </div>

              {/* Zones */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Parking Zones</label>
                  <span className={`text-xs font-bold ${totalEventSlots > eventForm.max_cars ? "text-red-500" : "text-emerald-600"}`}>
                    {totalEventSlots} / {eventForm.max_cars} slots
                  </span>
                </div>
                {eventForm.zones.map((z, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <input  type="text" placeholder="Zone name (e.g. A)"
                      value={z.name}
                      onChange={e => {
                        const zones = [...eventForm.zones];
                        zones[i] = { ...zones[i], name: e.target.value };
                        setEventForm(prev => ({ ...prev, zones }));
                      }}
                      className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]" />
                    <input type="number" placeholder="Slots" min="1"
                      value={z.slots}
                      onChange={e => {
                        const zones = [...eventForm.zones];
                        zones[i] = { ...zones[i], slots: parseInt(e.target.value) || 0 };
                        setEventForm(prev => ({ ...prev, zones }));
                      }}
                      className="w-24 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]" />
                    {eventForm.zones.length > 1 && (
                      <button type="button" onClick={() => setEventForm(prev => ({ ...prev, zones: prev.zones.filter((_, k) => k !== i) }))}
                        className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
                {totalEventSlots > eventForm.max_cars && (
                  <p className="text-xs text-red-500 font-medium mt-1">⚠ Total zone slots exceed max cars. Please reduce.</p>
                )}
                <button type="button"
                  onClick={() => setEventForm(prev => ({ ...prev, zones: [...prev.zones, { name: "", slots: 10 }] }))}
                  className="mt-1 text-xs font-bold text-[#1D4ED8] hover:underline">
                  + Add Zone
                </button>
              </div>


              <p className="text-xs text-gray-400 mb-2"><span className="text-red-500">*</span> Required fields</p>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowEventModal(false)}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-600 hover:bg-gray-50 transition">
                  Cancel
                </button>
                <button type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-[#0F2044] text-white text-sm font-bold hover:bg-[#1A3C6E] transition shadow-sm">
                  Create Event
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </OwnerLayout>
  );
}
