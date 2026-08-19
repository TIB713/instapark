import { useEffect, useState, useRef } from "react";
import SuperLayout from "@/components/layout/SuperLayout";
import { api, WS_BASE } from "@/lib/api";
import { fmtDateTime, fmtDuration } from "@/lib/time";
import StatusBadge from "@/components/ui/StatusBadge";
import { toast } from "sonner";
import { Car, Clock, AlertTriangle, ParkingSquare, Search, ChevronRight, ArrowLeft } from "lucide-react";

import LiveDriverMap from "@/components/LiveDriverMap";

export default function LiveMonitor() {
  const [activeTab, setActiveTab] = useState("queue"); // "queue" | "tracking"
  const [locations, setLocations] = useState([]);
  const [locationsPage, setLocationsPage] = useState(1);
  const locationsIntervalRef = useRef(null);
  const [liveMapDriver, setLiveMapDriver] = useState(null);
  const [events, setEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState("");
  const [eventSearch, setEventSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(10);
  const [queue, setQueue] = useState([]);
  const [queuePage, setQueuePage] = useState(1);
  const [loading, setLoading] = useState(false);
  const wsRef = useRef(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    api.get("/events").then(({ data }) => {
      const active = (data || []).filter(e => e.status?.toLowerCase() === 'active');
      const sorted = active.sort((a, b) => new Date(b.date) - new Date(a.date));
      setEvents(sorted);
    }).catch(() => toast.error("Failed to load events"));
  }, []);

  useEffect(() => {
    setVisibleCount(10);
  }, [eventSearch]);

  const filteredEvents = events.filter(e =>
    !eventSearch.trim() ||
    e.name?.toLowerCase().includes(eventSearch.toLowerCase()) ||
    e.date?.includes(eventSearch) ||
    e.venue?.toLowerCase().includes(eventSearch.toLowerCase())
  );

  const fetchQueue = async (eid) => {
    if (!eid) return;
    try {
      const { data } = await api.get(`/events/${eid}/queue`);
      setQueue(data || []);
    } catch {
      toast.error("Failed to load queue");
    }
  };

  const fetchLocations = async (eid) => {
    if (!eid) return;
    try {
      const { data } = await api.get(`/superadmin/events/${eid}/driver-locations`);
      setLocations(data || []);
    } catch (e) {
      toast.error("Failed to load driver locations");
    }
  };

  useEffect(() => {
    setLocationsPage(1);
    if (!selectedEvent || activeTab !== "tracking") return;
    fetchLocations(selectedEvent);
    locationsIntervalRef.current = setInterval(() => fetchLocations(selectedEvent), 5000);
    return () => clearInterval(locationsIntervalRef.current);
  }, [selectedEvent, activeTab]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(locations.length / 10));
    if (locationsPage > maxPage) {
      setLocationsPage(maxPage);
    }
  }, [locations, locationsPage]);

  useEffect(() => {
    setQueuePage(1);
    if (!selectedEvent || activeTab !== "queue") return;
    setLoading(true);
    fetchQueue(selectedEvent).finally(() => setLoading(false));

    intervalRef.current = setInterval(() => fetchQueue(selectedEvent), 8000);

    const token = localStorage.getItem("superadmin_token");
    const ws = new WebSocket(`${WS_BASE}/ws/event/${selectedEvent}?token=${token}`);
    ws.onmessage = () => fetchQueue(selectedEvent);
    wsRef.current = ws;

    return () => {
      clearInterval(intervalRef.current);
      ws.close();
    };
  }, [selectedEvent, activeTab]);

  const total = queue.length;
  const waiting = queue.filter(c => c.status === "CHECKED_IN").length;
  const parked = queue.filter(c => c.status === "PARKED").length;
  const retrievals = queue.filter(c => ["RETRIEVAL_REQUESTED", "BEING_FETCHED"].includes(c.status)).length;

  const getDriverName = (car) => {
    if (["RETRIEVAL_REQUESTED", "BEING_FETCHED"].includes(car.status)) return car.retrieval_driver_name || car.parked_driver_name || "—";
    if (car.status === "PARKED") return car.parked_driver_name || "—";
    return car.check_in_driver_name || "—";
  };

  return (
    <SuperLayout title="Live Monitor">
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <h1 className="text-2xl font-bold text-[#0F2044]">Live Monitor</h1>
          <span className="flex items-center gap-1.5 text-sm text-green-600 font-medium">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block" />
            Live
          </span>
        </div>

        {!selectedEvent && (
          <div className="mb-6">
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search events by name, date or venue..."
                value={eventSearch}
                onChange={e => setEventSearch(e.target.value)}
                className="border border-gray-200 rounded-xl pl-9 pr-4 py-2.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-[#0F2044]/20 focus:border-[#0F2044]"
              />
            </div>
            <div className="flex items-center justify-between mb-2 px-1">
              <p className="text-xs text-gray-400 font-medium">
                {eventSearch.trim()
                  ? `${filteredEvents.length} of ${events.length} active events`
                  : `${events.length} active event${events.length === 1 ? "" : "s"}`}
              </p>
            </div>
            {filteredEvents.length === 0 && eventSearch.trim() !== "" ? (
              <p className="text-sm text-center text-gray-400 py-8">No events match your search</p>
            ) : (
              <>
                <div className="space-y-3">
                  {filteredEvents.slice(0, visibleCount).map(e => {
                    const isSelected = selectedEvent === e.id;
                    const isActive = e.status?.toLowerCase() === 'active';
                    return (
                      <div
                        key={e.id}
                        onClick={() => setSelectedEvent(e.id)}
                        className={`cursor-pointer rounded-xl border px-5 py-4 transition-all flex items-center justify-between ${isSelected
                            ? "border-[#0F2044] bg-[#0F2044]/5"
                            : "border-gray-100 hover:border-gray-300 hover:bg-gray-50"
                          }`}
                      >
                        <div>
                          <p className="font-bold text-[#0F2044] text-sm">{e.name}</p>
                          <p className="text-xs text-gray-500 mt-1">{e.date} • {e.venue}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700"
                            }`}>
                            {e.status?.toLowerCase() || 'closed'}
                          </span>
                          <ChevronRight className="w-5 h-5 text-gray-400" />
                        </div>
                      </div>
                    );
                  })}
                </div>
                {filteredEvents.length > visibleCount && (
                  <div className="flex justify-center mt-4">
                    <button
                      onClick={() => setVisibleCount(v => v + 10)}
                      className="text-sm font-semibold text-[#0F2044] bg-white border border-gray-200 px-6 py-2 rounded-lg shadow-sm hover:bg-gray-50 transition-colors"
                    >
                      Load More
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {selectedEvent && (
          <>
            <div
              onClick={() => setSelectedEvent("")}
              className="text-sm text-[#0F2044] font-medium flex items-center gap-1 mb-4 hover:underline cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" /> Back to events
            </div>
            <h2 className="text-lg font-bold text-[#0F2044] mb-4">
              {events.find(e => e.id === selectedEvent)?.name} — {events.find(e => e.id === selectedEvent)?.date}
            </h2>
            <div className="flex gap-2 mb-6 border-b border-gray-200">
              <button
                onClick={() => setActiveTab("queue")}
                className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${activeTab === "queue" ? "border-[#0F2044] text-[#0F2044]" : "border-transparent text-gray-400 hover:text-gray-600"}`}
              >
                Car Queue
              </button>
              <button
                onClick={() => setActiveTab("tracking")}
                className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${activeTab === "tracking" ? "border-[#0F2044] text-[#0F2044]" : "border-transparent text-gray-400 hover:text-gray-600"}`}
              >
                Driver Tracking
              </button>
            </div>
            {/* Stat Cards */}
            {activeTab === "queue" && (
              <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              {[
                { label: "Total Cars", value: total, color: "text-[#0F2044]", bg: "bg-blue-50" },
                { label: "Waiting", value: waiting, color: "text-orange-600", bg: "bg-orange-50" },
                { label: "Parked", value: parked, color: "text-green-600", bg: "bg-green-50" },
                { label: "Retrievals", value: retrievals, color: "text-red-600", bg: "bg-red-50" },
              ].map(s => (
                <div key={s.label} className={`${s.bg} rounded-xl p-4 shadow-sm`}>
                  <p className="text-xs text-gray-500 font-medium mb-1">{s.label}</p>
                  <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>

            {/* Queue Table */}
            {loading ? (
              <div className="text-center py-12 text-gray-400">Loading queue...</div>
            ) : queue.length === 0 ? (
              <div className="text-center py-12 text-gray-400">No cars in queue for this event.</div>
            ) : (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[600px]">
                    <thead>
                      <tr className="bg-[#0F2044] text-white text-xs uppercase tracking-wide">
                        <th className="px-4 py-3 text-left">Car Number</th>
                        <th className="px-4 py-3 text-left">Guest</th>
                        <th className="px-4 py-3 text-left">Status</th>
                        <th className="px-4 py-3 text-left">Driver</th>
                        <th className="px-4 py-3 text-left">Zone / Slot</th>
                        <th className="px-4 py-3 text-left">Time in Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(() => {
                        const paginatedQueue = queue.slice((queuePage - 1) * 10, queuePage * 10);
                        return paginatedQueue.map(car => {
                          const isUrgent = ["RETRIEVAL_REQUESTED", "BEING_FETCHED"].includes(car.status);
                          const isLate = car.minutes_in_current_status > 10 && !["DELIVERED", "PARKED"].includes(car.status);
                          return (
                            <tr key={car.car_id} className={isUrgent ? "bg-amber-50" : "hover:bg-gray-50"}>
                              <td className="px-4 py-3 font-semibold text-[#0F2044]">{car.car_number || "—"}</td>
                              <td className="px-4 py-3 text-gray-600">{car.guest_name || "—"}</td>
                              <td className="px-4 py-3"><StatusBadge status={car.status} /></td>
                              <td className="px-4 py-3 text-gray-600">{getDriverName(car)}</td>
                              <td className="px-4 py-3 text-gray-500">{car.zone && car.slot ? `${car.zone} / ${car.slot}` : "—"}</td>
                              <td className="px-4 py-3">
                                {car.minutes_in_current_status != null ? (
                                  <span className={isLate ? "text-red-600 font-bold" : "text-gray-500"}>
                                    {fmtDuration(car.minutes_in_current_status)}
                                  </span>
                                ) : "—"}
                              </td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                  {queue.length > 10 && (
                    <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between">
                      <span className="text-sm text-gray-400">
                        Showing {Math.min((queuePage - 1) * 10 + 1, queue.length)}–{Math.min(queuePage * 10, queue.length)} of {queue.length}
                      </span>
                      <div className="flex items-center gap-2">
                        <button disabled={queuePage === 1} onClick={() => setQueuePage(p => p - 1)}
                          className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Prev</button>
                        <span className="px-3 py-1.5 rounded-lg bg-[#0F2044] text-white text-sm font-bold">{queuePage}</span>
                        <button disabled={queuePage * 10 >= queue.length} onClick={() => setQueuePage(p => p + 1)}
                          className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Next</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
              </>
            )}
            
            {activeTab === "tracking" && (
              <>
                {locations.length === 0 ? (
                  <div className="text-center py-8 text-gray-400 text-sm">No driver location data yet.</div>
                ) : (
                <div className="overflow-hidden rounded-xl border border-gray-100">
                  <div className="overflow-x-auto w-full max-w-full">
                  <table className="w-full text-sm min-w-[500px]">
                    <thead>
                      <tr className="bg-[#0F2044] text-white text-xs uppercase tracking-wide">
                        <th className="px-4 py-3 text-left">Driver</th>
                        <th className="px-4 py-3 text-left">Latitude</th>
                        <th className="px-4 py-3 text-left">Longitude</th>
                        <th className="px-4 py-3 text-left">Last Updated</th>
                        <th className="px-4 py-3 text-left">Map</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(() => {
                        const paginatedLocations = locations.slice((locationsPage - 1) * 10, locationsPage * 10);
                        return paginatedLocations.map(loc => (
                        <tr key={loc.driver_id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-[#0F2044]">{loc.driver_name}</td>
                          <td className="px-4 py-3 text-gray-600 font-mono text-xs">{loc.lat?.toFixed(6)}</td>
                          <td className="px-4 py-3 text-gray-600 font-mono text-xs">{loc.lng?.toFixed(6)}</td>
                          <td className="px-4 py-3 text-gray-500">{fmtDateTime(loc.timestamp)}</td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => setLiveMapDriver({ driver_id: loc.driver_id, driver_name: loc.driver_name })}
                              className="text-[#0F2044] hover:underline text-xs font-semibold"
                            >
                              Live Map →
                            </button>
                          </td>
                        </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                  {locations.length > 10 && (
                    <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between">
                      <span className="text-sm text-gray-400">
                        Showing {Math.min((locationsPage - 1) * 10 + 1, locations.length)}–{Math.min(locationsPage * 10, locations.length)} of {locations.length}
                      </span>
                      <div className="flex items-center gap-2">
                        <button disabled={locationsPage === 1} onClick={() => setLocationsPage(p => p - 1)}
                          className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Prev</button>
                        <span className="px-3 py-1.5 rounded-lg bg-[#0F2044] text-white text-sm font-bold">{locationsPage}</span>
                        <button disabled={locationsPage * 10 >= locations.length} onClick={() => setLocationsPage(p => p + 1)}
                          className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Next</button>
                      </div>
                    </div>
                  )}
                  </div>
                </div>
                )}
              </>
            )}
          </>
        )}
      </div>
      {liveMapDriver && (
        <LiveDriverMap
          driverId={liveMapDriver.driver_id}
          driverName={liveMapDriver.driver_name}
          eventId={selectedEvent}
          onClose={() => setLiveMapDriver(null)}
        />
      )}
    </SuperLayout>
  );
}
