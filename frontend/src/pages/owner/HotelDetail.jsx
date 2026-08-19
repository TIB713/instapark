import { useEffect, useState, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import OwnerLayout from "@/components/layout/OwnerLayout";
import { api } from "@/lib/api";
import { fmtDate, fmtDateTimeFull } from "@/lib/time";
import { toast } from "sonner";
import {
  ArrowLeft, Building2, MapPin, Phone, Mail,
  Calendar, ShieldCheck, User, Users, Car, AlertTriangle
} from "lucide-react";
import StatusBadge from "@/components/ui/StatusBadge";

export default function OwnerHotelDetail() {
  const { hid } = useParams();
  const [hotel, setHotel] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("info");

  // Lazy-loaded data
  const [events, setEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [cars, setCars] = useState([]);
  const [loadingCars, setLoadingCars] = useState(false);
  const [incidents, setIncidents] = useState([]);
  const [loadingIncidents, setLoadingIncidents] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [resHotel, resDetail] = await Promise.all([
          api.get(`/hotels/${hid}`),
          api.get(`/hotels/${hid}/detail`)
        ]);
        setHotel(resHotel.data);
        setDetail(resDetail.data);
      } catch (err) {
        toast.error("Failed to load hotel details");
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [hid]);

  useEffect(() => {
    if (activeTab === "events" && events.length === 0) {
      setLoadingEvents(true);
      api.get(`/hotels/${hid}/events`, { params: { event_type: "daily", status: "all" } })
        .then(r => setEvents(r.data.events || []))
        .catch(() => toast.error("Failed to load events"))
        .finally(() => setLoadingEvents(false));
    }
    if (activeTab === "cars" && cars.length === 0) {
      setLoadingCars(true);
      api.get(`/hotels/${hid}/cars`)
        .then(r => setCars(r.data))
        .catch(() => toast.error("Failed to load cars"))
        .finally(() => setLoadingCars(false));
    }
    if (activeTab === "incidents" && incidents.length === 0) {
      setLoadingIncidents(true);
      api.get(`/hotels/${hid}/incidents`)
        .then(r => setIncidents(r.data))
        .catch(() => toast.error("Failed to load incidents"))
        .finally(() => setLoadingIncidents(false));
    }
  }, [activeTab, events.length, cars.length, incidents.length, hid]);

  if (loading) {
    return (
      <OwnerLayout title="Hotel Detail">
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
          <div className="w-10 h-10 rounded-full border-4 border-[#1A3C6E] border-t-transparent animate-spin" />
          <p className="text-gray-400 text-sm font-medium">Loading...</p>
        </div>
      </OwnerLayout>
    );
  }

  if (!hotel) {
    return (
      <OwnerLayout title="Hotel Detail">
        <div className="text-center py-20 text-gray-500">Hotel not found.</div>
      </OwnerLayout>
    );
  }

  const s = detail?.stats || {};
  const drivers = detail?.assigned_drivers || [];
  const supervisors = detail?.assigned_supervisors || [];

  return (
    <OwnerLayout title="Hotel Detail">
      <Link to="/provider/hotels" className="inline-flex items-center gap-1.5 text-sm font-medium text-[#1A3C6E] hover:text-[#0F2044] mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Hotels
      </Link>

      <div className="bg-[#0F2044] rounded-2xl overflow-hidden shadow-card mb-6">
        <div className="px-4 sm:px-8 pt-4 sm:pt-8 pb-4 sm:pb-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            {/* LEFT */}
            <div className="flex items-start gap-4 min-w-0">
              <div className="relative group shrink-0">
                <div className="w-16 h-16 rounded-2xl bg-white/10 border-2 border-white/20 shadow-lg flex items-center justify-center">
                  <Building2 className="w-8 h-8 text-white" />
                </div>
              </div>
              
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h1 className="font-heading text-2xl font-bold text-white truncate">{hotel.name}</h1>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${hotel.is_active !== false ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/30" : "bg-red-500/20 text-red-300 border border-red-400/30"}`}>
                    {hotel.is_active !== false ? "Active" : "Inactive"}
                  </span>
                </div>
                <div className="flex items-center gap-4 mt-1 text-xs text-white/70">
                  <div className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-white/50" />{hotel.city}, {hotel.state}</div>
                </div>
                
                <div className="mt-4 pt-4 border-t border-white/10 grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
                  {[
                    { label: "Events", value: s.total_events || 0, icon: Calendar, tab: "events" },
                    { label: "Cars Served", value: s.total_cars_served || 0, icon: Car, tab: "cars" },
                    { label: "Drivers", value: drivers.length, icon: Users, tab: "drivers" },
                    { label: "Supervisors", value: supervisors.length, icon: ShieldCheck, tab: "supervisors" },
                    { label: "Incidents", value: incidents.length || 0, icon: AlertTriangle, tab: "incidents" }
                  ].map(stat => (
                    <div
                      key={stat.label}
                      onClick={() => setActiveTab(stat.tab)}
                      className={`bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 flex flex-col items-center gap-1 transition-all duration-150 cursor-pointer hover:bg-white/15 hover:border-amber-400/40 hover:scale-[1.03] ${activeTab === stat.tab ? "bg-white/15 border-amber-400/50 ring-1 ring-amber-400/30" : ""}`}
                    >
                      <div className="flex items-center gap-1 text-amber-400">
                        <stat.icon className="w-3 h-3" />
                        <div className="text-[8px] uppercase font-bold text-white/40 tracking-wider">{stat.label}</div>
                      </div>
                      <div className="text-lg font-black text-white">{stat.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* RIGHT */}
            <div className="flex items-start gap-4 flex-wrap shrink-0">
              <Link to={`/provider/events?hotel_id=${hid}`} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border border-white/30 text-white bg-white/10 hover:bg-white/20 transition">
                <Calendar className="w-4 h-4" /> View Events
              </Link>
            </div>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex bg-black/20 border-t-2 border-amber-400/20 overflow-x-auto">
          {[
            { id: "info", label: "Info", icon: Building2 },
            { id: "events", label: "Events", icon: Calendar },
            { id: "drivers", label: "Drivers", icon: Users },
            { id: "supervisors", label: "Supervisors", icon: ShieldCheck },
            { id: "cars", label: "Cars", icon: Car },
            { id: "incidents", label: "Incidents", icon: AlertTriangle }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 sm:px-6 py-3 sm:py-3.5 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap border-b-[3px] ${
                activeTab === tab.id
                  ? "text-amber-400 border-[#F59E0B]"
                  : "text-white/40 border-transparent hover:text-white/70"
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6">
        {activeTab === "info" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 fade-in-up">
            <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-6">
              <h3 className="font-heading text-lg font-bold text-[#0F2044] mb-4">Contact Info</h3>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center shrink-0"><User className="w-4 h-4 text-gray-500" /></div>
                  <div><div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-0.5">Manager</div><div className="text-sm font-medium text-gray-900">{hotel.contact_person_name || "—"}</div></div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center shrink-0"><Phone className="w-4 h-4 text-gray-500" /></div>
                  <div><div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-0.5">Phone</div><div className="text-sm font-medium text-gray-900">{hotel.contact_person_phone || "—"}</div></div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center shrink-0"><Mail className="w-4 h-4 text-gray-500" /></div>
                  <div><div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-0.5">Email</div><div className="text-sm font-medium text-gray-900 break-all">{hotel.contact_person_email || "—"}</div></div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-6">
              <h3 className="font-heading text-lg font-bold text-[#0F2044] mb-4">Performance</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-xl p-4">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total Events</div>
                  <div className="font-heading text-2xl font-bold text-[#0F2044] mt-1">{s.total_events || 0}</div>
                </div>
                <div className="bg-emerald-50 rounded-xl p-4">
                  <div className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Cars Served</div>
                  <div className="font-heading text-2xl font-bold text-emerald-700 mt-1">{s.total_cars_served || 0}</div>
                </div>
                <div className="bg-amber-50 rounded-xl p-4">
                  <div className="text-xs font-semibold text-amber-600 uppercase tracking-wider">Platform Rating</div>
                  <div className="font-heading text-2xl font-bold text-amber-700 mt-1 flex items-center gap-1">
                    {s.platform_avg_rating > 0 ? `${s.platform_avg_rating}★` : "—"}
                  </div>
                </div>
                <div className="bg-indigo-50 rounded-xl p-4">
                  <div className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">Valet Slots</div>
                  <div className="font-heading text-2xl font-bold text-indigo-700 mt-1">{hotel.total_valet_slots || 0}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "drivers" && (
          <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-6 fade-in-up">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-heading text-lg font-bold text-[#0F2044] flex items-center gap-2">
                <Users className="w-5 h-5 text-amber-500" /> Assigned Drivers
              </h3>
              <span className="text-xs font-semibold bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">{drivers.length} Total</span>
            </div>
            {drivers.length === 0 ? (
              <div className="text-center py-8 text-sm text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-200">No drivers assigned to this hotel.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {drivers.map(drv => (
                  <div key={drv.id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 bg-gray-50/50">
                    <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center font-bold text-sm shrink-0">
                      {drv.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-gray-900 truncate">{drv.name}</div>
                      <div className="text-xs text-gray-500 truncate">{drv.phone}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "supervisors" && (
          <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-6 fade-in-up">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-heading text-lg font-bold text-[#0F2044] flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-indigo-500" /> Assigned Supervisors
              </h3>
              <span className="text-xs font-semibold bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">{supervisors.length} Total</span>
            </div>
            {supervisors.length === 0 ? (
              <div className="text-center py-8 text-sm text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-200">No supervisors assigned to this hotel.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {supervisors.map(sup => (
                  <div key={sup.id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 bg-gray-50/50">
                    <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-sm shrink-0">
                      {sup.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-gray-900 truncate">{sup.name}</div>
                      <div className="text-xs text-gray-500 truncate">{sup.phone}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "events" && (
          <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden fade-in-up">
            {loadingEvents ? (
              <div className="p-8 text-center text-sm text-gray-500">Loading events...</div>
            ) : events.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500 bg-gray-50 border-b border-gray-100">No events found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr>
                      <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider bg-gray-50 border-b border-gray-100">Date</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider bg-gray-50 border-b border-gray-100">Event Name</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider bg-gray-50 border-b border-gray-100">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {events.map((e, idx) => (
                      <tr key={idx} className="hover:bg-gray-50/50 transition">
                        <td className="px-6 py-4 text-sm font-medium text-gray-900">{fmtDate(e.date)}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">{e.name}</td>
                        <td className="px-6 py-4">
                          <StatusBadge status={e.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === "cars" && (
          <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden fade-in-up">
            {loadingCars ? (
              <div className="p-8 text-center text-sm text-gray-500">Loading cars...</div>
            ) : cars.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500 bg-gray-50 border-b border-gray-100">No cars found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr>
                      <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider bg-gray-50 border-b border-gray-100">Plate</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider bg-gray-50 border-b border-gray-100">Make/Color</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider bg-gray-50 border-b border-gray-100">Total Visits</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider bg-gray-50 border-b border-gray-100">Last Seen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {cars.map((c, idx) => (
                      <tr key={idx} className="hover:bg-gray-50/50 transition">
                        <td className="px-6 py-4 text-sm font-bold text-gray-900 uppercase tracking-wider">{c.plate}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">{c.make || "—"} / {c.color || "—"}</td>
                        <td className="px-6 py-4 text-sm text-gray-600 font-medium">{c.total_visits || 1}</td>
                        <td className="px-6 py-4 text-xs text-gray-500">{c.last_seen ? fmtDateTimeFull(c.last_seen) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === "incidents" && (
          <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden fade-in-up">
            {loadingIncidents ? (
              <div className="p-8 text-center text-sm text-gray-500">Loading incidents...</div>
            ) : incidents.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500 bg-gray-50 border-b border-gray-100">No incidents found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr>
                      <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider bg-gray-50 border-b border-gray-100">Event</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider bg-gray-50 border-b border-gray-100">Description</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider bg-gray-50 border-b border-gray-100">Reported At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {incidents.map((inc, idx) => (
                      <tr key={idx} className="hover:bg-gray-50/50 transition">
                        <td className="px-6 py-4 text-sm font-medium text-gray-900">{inc.event_name || "—"}</td>
                        <td className="px-6 py-4 text-sm text-gray-600 max-w-md">{inc.description}</td>
                        <td className="px-6 py-4 text-xs text-gray-500">{inc.created_at ? fmtDateTimeFull(inc.created_at) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </OwnerLayout>
  );
}
