import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api, WS_BASE } from "@/lib/api";
import { fmtDuration } from "@/lib/time";
import StatusBadge from "@/components/ui/StatusBadge";

const STALE_MINUTES_THRESHOLD = 5;
const MAX_ROWS = 14; // Fixed compact row count

export default function LiveQueueView() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [page, setPage] = useState(0);
  const wsRef = useRef(null);

  const fetchQueue = async () => {
    try {
      const { data } = await api.get(`/live-queue/${token}`);
      setData(data);
    } catch {
      setError(true);
    }
  };

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 15000);
    return () => clearInterval(interval);
  }, [token]);

  useEffect(() => {
    if (!data?.event_id) return;
    const ws = new WebSocket(`${WS_BASE}/ws/live-queue/${data.event_id}?token=${token}`);
    ws.onmessage = fetchQueue;
    wsRef.current = ws;
    return () => ws.close();
  }, [data?.event_id]);

  const queue = data?.queue || [];
  
  const sortedQueue = [...queue].sort((a, b) => {
    const aDelivered = a.status === "DELIVERED";
    const bDelivered = b.status === "DELIVERED";
    if (aDelivered && !bDelivered) return 1;
    if (!aDelivered && bDelivered) return -1;
    return 0;
  });

  const totalPages = Math.ceil(sortedQueue.length / MAX_ROWS) || 1;

  useEffect(() => {
    if (totalPages <= 1) {
      setPage(0);
      return;
    }
    const timer = setInterval(() => {
      setPage(p => (p + 1) % totalPages);
    }, 8000);
    return () => clearInterval(timer);
  }, [totalPages]);

  if (error) {
    return (
      <div className="h-screen w-screen overflow-hidden flex flex-col items-center justify-center bg-brand-purple">
        <p className="text-white text-3xl font-bold font-heading">This live queue link isn't valid or has expired.</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="h-screen w-screen overflow-hidden flex flex-col items-center justify-center bg-brand-purple">
        <p className="text-white/60 text-3xl font-bold font-heading">Loading queue...</p>
      </div>
    );
  }

  const waiting = queue.filter(c => c.status === "CHECKED_IN").length;
  const parked = queue.filter(c => c.status === "PARKED").length;
  const retrievals = queue.filter(c => ["RETRIEVAL_REQUESTED", "ACCEPTED", "BEING_FETCHED"].includes(c.status)).length;

  // Fixed compact row sizing, decoupled from queue length
  const tablePy = "py-2.5";
  const textSize = "text-lg";

  const visibleQueue = sortedQueue.slice(page * MAX_ROWS, (page + 1) * MAX_ROWS);

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-brand-cream font-body text-brand-dark">
      {/* Header */}
      <div className="bg-brand-purple px-8 py-3 shadow-md shrink-0 flex items-center gap-4">
        <h1 className="text-2xl md:text-3xl font-extrabold text-white font-heading">{data.event_name}</h1>
        <span className="flex items-center gap-1.5 text-sm text-brand-gold font-bold">
          <span className="w-2.5 h-2.5 rounded-full bg-brand-gold animate-pulse inline-block" />
          Live
        </span>
        <span className="text-white/40 text-xl font-light">&middot;</span>
        <p className="text-white/80 text-lg font-medium">{data.venue} &middot; {data.event_date}</p>
      </div>

      <div className="px-6 md:px-10 py-4 flex-1 flex flex-col max-w-[120rem] mx-auto w-full overflow-hidden">
        {/* Legend */}
        <div className="flex items-center gap-6 mb-4 px-2 shrink-0">
          <span className="font-bold text-sm uppercase tracking-wide mr-2 text-brand-dark/60">Legend:</span>
          <div className="flex items-center gap-2 text-sm font-medium text-brand-dark/80">
            <span className="w-3 h-3 rounded-full bg-blue-500"></span> Waiting
          </div>
          <div className="flex items-center gap-2 text-sm font-medium text-brand-dark/80">
            <span className="w-3 h-3 rounded-full bg-green-500"></span> Parked
          </div>
          <div className="flex items-center gap-2 text-sm font-medium text-brand-dark/80">
            <span className="w-3 h-3 rounded-full bg-amber-500"></span> Requested
          </div>
          <div className="flex items-center gap-2 text-sm font-medium text-brand-dark/80">
            <span className="w-3 h-3 rounded-full bg-red-500"></span> On the way
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-6 mb-4 shrink-0">
          {[
            { label: "Waiting", value: waiting, color: "text-blue-600", bg: "bg-blue-50 border-blue-100" },
            { label: "Parked", value: parked, color: "text-green-600", bg: "bg-green-50 border-green-100" },
            { label: "Retrievals", value: retrievals, color: "text-brand-gold", bg: "bg-amber-50 border-amber-100" },
          ].map(s => (
            <div key={s.label} className={`${s.bg} border rounded-xl p-3 shadow-sm flex items-center justify-center gap-4`}>
              <p className="text-sm text-brand-dark/70 font-bold uppercase tracking-wide font-body">{s.label}</p>
              <p className={`text-3xl md:text-4xl font-extrabold ${s.color} font-heading`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Table Area */}
        {queue.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-center text-brand-dark/50 text-3xl font-medium font-body">
            No cars in the queue right now.
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 flex-1 flex flex-col overflow-hidden relative">
            <table className="w-full text-lg">
              <thead className="shrink-0 bg-brand-purple text-white text-lg uppercase tracking-wider font-heading">
                <tr>
                  <th className="px-8 py-4 text-left font-bold w-1/3">Car Number</th>
                  {/* Guest name intentionally hidden on public display — do not remove, may be re-enabled later */}
                  {/* <th className="px-8 py-4 text-left font-bold">Guest</th> */}
                  <th className="px-8 py-4 text-left font-bold w-1/3">Status</th>
                  <th className="px-8 py-4 text-left font-bold w-1/3">Time in Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visibleQueue.map(car => {
                  let rowClasses = "";
                  const isDelivered = car.status === "DELIVERED";
                  
                  if (car.status === "CHECKED_IN") rowClasses = "border-l-8 border-blue-500 bg-blue-50/40";
                  else if (car.status === "PARKED") rowClasses = "border-l-8 border-green-500 bg-green-50/40";
                  else if (car.status === "RETRIEVAL_REQUESTED") rowClasses = "border-l-8 border-amber-500 bg-amber-50/40 animate-blink-slow";
                  else if (["ACCEPTED", "BEING_FETCHED"].includes(car.status)) rowClasses = "border-l-8 border-red-500 bg-red-50/40 animate-blink-fast";
                  else if (isDelivered) rowClasses = "border-l-8 border-gray-300 bg-gray-50/50 opacity-60";
                  
                  const isStale = !isDelivered && ["RETRIEVAL_REQUESTED", "ACCEPTED", "BEING_FETCHED"].includes(car.status) 
                    && car.minutes_in_current_status >= STALE_MINUTES_THRESHOLD;

                  return (
                    <tr key={car.car_id} className={rowClasses}>
                      <td className={`px-8 ${tablePy} font-extrabold ${isDelivered ? "text-gray-400" : "text-brand-dark"} ${textSize} tracking-wide font-body`}>
                        {car.car_number || "—"}
                      </td>
                      {/* Guest name intentionally hidden on public display — do not remove, may be re-enabled later */}
                      {/* <td className={`px-8 ${tablePy} text-gray-600 font-medium font-body`}>{car.guest_name || "—"}</td> */}
                      <td className={`px-8 ${tablePy}`}>
                        <div className={`scale-110 origin-left inline-block ${isDelivered ? "grayscale opacity-70" : ""}`}>
                          <StatusBadge status={car.status} />
                        </div>
                      </td>
                      <td className={`px-8 ${tablePy} font-bold ${textSize} ${isStale ? "text-red-600" : (isDelivered ? "text-gray-400" : "text-brand-dark/70")} font-body`}>
                        {car.minutes_in_current_status != null ? fmtDuration(car.minutes_in_current_status) : "—"}
                        {isStale && <span className="ml-3 uppercase text-sm tracking-wide bg-amber-100 px-3 py-1.5 rounded text-amber-700">Urgent</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            
            {/* Pagination Indicator */}
            {totalPages > 1 && (
              <div className="absolute bottom-4 right-6 bg-brand-dark/80 text-white px-4 py-2 rounded-full font-bold text-sm font-body shadow-md">
                Page {page + 1} of {totalPages}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
