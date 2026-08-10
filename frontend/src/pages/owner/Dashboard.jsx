import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import OwnerLayout from "@/components/layout/OwnerLayout";
import { api, decodeJwt } from "@/lib/api";
import { Building2, Hotel, CalendarClock, Users, Car, Star, ChevronRight, AlertTriangle, TrendingUp, TrendingDown, Clock, CheckCircle2 } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import StatCard from "@/components/ui/StatCard";
import SkeletonTable from "@/components/ui/SkeletonTable";

export default function OwnerDashboard() {
  const nav = useNavigate();
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activityRange, setActivityRange] = useState("week"); // "week" | "month" | "custom"
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const token = localStorage.getItem("owner_token");
  const payload = token ? decodeJwt(token) : null;
  const name = payload?.name || localStorage.getItem("owner_name") || "Owner";
  const providerType = payload?.provider_type || localStorage.getItem("owner_provider_type") || "valet_provider";

  const loadStats = async () => {
    try {
      const { data } = await api.get("/providers/me/stats");
      setStats(data);
    } catch (err) {
      console.error("Failed to load dashboard stats", err);
    } finally {
      setLoading(false);
    }
  };

  const loadActivity = async () => {
    try {
      const activityUrl = activityRange === "custom"
        ? `/providers/me/stats/activity?start=${customStart}&end=${customEnd}`
        : `/providers/me/stats/activity?days=${activityRange === "month" ? 30 : 7}`;
      const { data } = await api.get(activityUrl);
      setActivity(data || []);
    } catch (err) {
      console.error("Failed to load dashboard activity", err);
      setActivity([]);
    }
  };

  useEffect(() => {
    loadStats();
    const t = setInterval(loadStats, 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (activityRange === "custom" && (!customStart || !customEnd)) return;
    loadActivity();
  }, [activityRange, customStart, customEnd]);

  if (loading && !stats) {
    return (
      <OwnerLayout title="Dashboard">
        <div className="mb-8">
          <div className="h-10 w-64 bg-gray-200 animate-pulse rounded-md mb-2"></div>
          <div className="h-5 w-48 bg-gray-200 animate-pulse rounded-md"></div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-5 mb-8">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-32 bg-white rounded-2xl shadow-card border border-gray-100 p-6 flex flex-col justify-between">
              <div className="flex justify-between items-start">
                <div className="w-20 h-4 bg-gray-200 rounded animate-pulse"></div>
                <div className="w-10 h-10 bg-gray-200 rounded-xl animate-pulse"></div>
              </div>
              <div className="w-16 h-8 bg-gray-200 rounded animate-pulse mt-4"></div>
            </div>
          ))}
        </div>
        <SkeletonTable rows={3} columns={5} />
      </OwnerLayout>
    );
  }

  // Fallback if data somehow fails entirely but loading is false
  const safeStats = stats || {};

  return (
    <OwnerLayout title="Dashboard">
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-bold text-[#0F2044]">Welcome, {name.split(" ")[0]}.</h1>
        <p className="text-gray-500 mt-1">
          {providerType === "hotel_owner" && safeStats.hotels_breakdown?.length > 0
            ? `Overview of ${safeStats.hotels_breakdown[0].name}`
            : "Live overview of your operations."}
        </p>
      </div>

      {/* Top Stat-Card Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-5 fade-in-up" style={{ animationDelay: '0ms' }}>
        {providerType === "valet_provider" && (
          <StatCard testid="stat-hotels" label="Total Hotels"
            value={safeStats.total_hotels ?? "—"}
            icon={<Building2 className="w-5 h-5 text-ownerGold" />} accent="bg-ownerGoldTint/40" />
        )}
        <StatCard testid="stat-events" label="Active Events"
          value={safeStats.active_events ?? "—"}
          sub={<span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500 pulse-dot inline-block" />running now</span>}
          icon={<CalendarClock className="w-5 h-5 text-emerald-600" />} accent="bg-emerald-50" />

        {providerType === "valet_provider" && (
          <StatCard testid="stat-staff" label="Total Staff"
            value={(safeStats.total_drivers || 0) + (safeStats.total_supervisors || 0)}
            sub="drivers & supervisors"
            icon={<Users className="w-5 h-5 text-[#1A3C6E]" />} accent="bg-[#1A3C6E]/10" />
        )}

        <StatCard testid="stat-cars" label="Total Cars"
          value={safeStats.total_cars ?? "—"}
          sub="all-time served"
          icon={<Car className="w-5 h-5 text-blue-600" />} accent="bg-blue-50" />
        <StatCard testid="stat-rating" label="Avg Rating"
          value={safeStats.platform_avg_rating ? `${safeStats.platform_avg_rating}★` : "—"}
          icon={<Star className="w-5 h-5 text-amber-500" />} accent="bg-amber-50" />
        <StatCard testid="stat-pending" label="Pending Fetch"
          value={safeStats.pending_retrievals ?? "—"}
          sub="retrievals requested"
          icon={<Clock className="w-5 h-5 text-rose-600" />} accent="bg-rose-50" />
      </div>

      {/* Today at a Glance */}
      <div className="mt-6 fade-in-up" style={{ animationDelay: '60ms' }}>
        <h2 className="font-heading text-lg font-semibold text-[#0F2044] mb-3">Today at a Glance</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="bg-white rounded-xl border border-gray-100 border-l-4 border-l-emerald-500 p-4">
            <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Events Today</div>
            <div className="mt-1 font-heading text-2xl font-bold text-[#0F2044]">{safeStats.today_events ?? 0}</div>
            <div className="text-[10px] text-gray-400 mt-1">scheduled for today</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 border-l-4 border-l-blue-500 p-4">
            <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Total Cars Today</div>
            <div className="mt-1 font-heading text-2xl font-bold text-[#0F2044]">{safeStats.today_cars ?? 0}</div>
            <div className="text-[10px] text-gray-400 mt-1">checked in today</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 border-l-4 border-l-indigo-500 p-4">
            <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Currently Parked</div>
            <div className="mt-1 font-heading text-2xl font-bold text-[#0F2044]">{safeStats.today_parked ?? 0}</div>
            <div className="text-[10px] text-gray-400 mt-1">still in parking</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 border-l-4 border-l-amber-500 p-4">
            <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Pending Retrievals</div>
            <div className="mt-1 font-heading text-2xl font-bold text-[#0F2044]">{safeStats.today_retrievals ?? 0}</div>
            <div className="text-[10px] text-gray-400 mt-1">waiting to be retrieved</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 border-l-4 border-l-emerald-500 p-4">
            <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Retrieved Today</div>
            <div className="mt-1 font-heading text-2xl font-bold text-[#0F2044]">{safeStats.today_retrieved ?? 0}</div>
            <div className="text-[10px] text-gray-400 mt-1">successfully delivered</div>
          </div>
        </div>
      </div>

      {/* Activity Chart */}
      <div className="mt-12 fade-in-up" style={{ animationDelay: '120ms' }}>
        <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="font-heading text-xl font-semibold text-[#0F2044]">
              Activity Trends — {
                activityRange === "month" ? "Last 30 Days" :
                  activityRange === "custom" ? (customStart && customEnd ? `${customStart} to ${customEnd}` : "Select a range") :
                    "Last 7 Days"
              }
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
                <button
                  onClick={() => setActivityRange("week")}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition ${activityRange === "week" ? "bg-white text-[#1A3C6E] shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                >
                  Week
                </button>
                <button
                  onClick={() => setActivityRange("month")}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition ${activityRange === "month" ? "bg-white text-[#1A3C6E] shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                >
                  Month
                </button>
                <button
                  onClick={() => setActivityRange("custom")}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition ${activityRange === "custom" ? "bg-white text-[#1A3C6E] shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                >
                  Custom
                </button>
              </div>
              {activityRange === "custom" && (
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={customStart}
                    max={customEnd || new Date().toISOString().slice(0, 10)}
                    onChange={e => setCustomStart(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 outline-none focus:border-ownerGold"
                  />
                  <span className="text-gray-400 text-sm">to</span>
                  <input
                    type="date"
                    value={customEnd}
                    min={customStart || undefined}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={e => setCustomEnd(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 outline-none focus:border-ownerGold"
                  />
                </div>
              )}
            </div>
          </div>
          <div style={{ width: "100%", height: 220 }}>
            {activityRange === "custom" && (!customStart || !customEnd) ? (
              <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                Select a start and end date to view activity
              </div>
            ) : activity.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                No activity data yet
              </div>
            ) : (
              <ResponsiveContainer>
                <BarChart data={activity} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: "#6b7280", fontSize: 12 }} interval={activity.length > 10 ? Math.ceil(activity.length / 10) - 1 : 0} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#9ca3af", fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    cursor={{ fill: "#f3f4f6" }}
                    contentStyle={{ borderRadius: 12, borderColor: "#e5e7eb" }}
                    formatter={(val) => [val, "Check-ins"]}
                  />
                  <Bar dataKey="checkins" fill="var(--owner-gold)" radius={[6, 6, 0, 0]} cursor="pointer" onClick={(data) => { if (data?.date) nav('/provider/cars?date=' + data.date); }} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Section: Performance Table (Provider) OR Quick Links (Hotel) */}
      <div className="mt-12 fade-in-up" style={{ animationDelay: '180ms' }}>
        {providerType === "valet_provider" ? (
          <>
            <h2 className="font-heading text-xl font-semibold text-[#0F2044] mb-4">Your Hotels</h2>
            <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px]">
                  <thead>
                    <tr className="bg-[#0F2044]/[0.04] text-left text-[11px] uppercase tracking-wider font-bold text-gray-500 border-b border-gray-100">
                      <th className="px-6 py-4 font-semibold text-gray-500 uppercase">Hotel</th>
                      <th className="px-6 py-4 font-semibold text-gray-500 uppercase">Location</th>
                      <th className="px-6 py-4 font-semibold text-gray-500 uppercase text-right">Active Events</th>
                      <th className="px-6 py-4 font-semibold text-gray-500 uppercase text-right">Cars Today</th>
                      <th className="px-6 py-4 font-semibold text-gray-500 uppercase text-right">Total Served</th>
                      <th className="px-6 py-4 font-semibold text-gray-500 uppercase text-right">Slots</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {safeStats.hotels_breakdown?.length > 0 ? (
                      safeStats.hotels_breakdown.map((h) => (
                        <tr key={h.id} onClick={() => nav(`/provider/hotels/${h.id}`)} className="hover:bg-gray-50 cursor-pointer transition-colors group">
                          <td className="px-6 py-4">
                            <div className="font-semibold text-[#0F2044] group-hover:text-ownerGold transition-colors">{h.name}</div>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-500">{h.city}, {h.state}</td>
                          <td className="px-6 py-4 text-right">
                            <span className={`inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-full text-xs font-semibold ${h.active_events > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                              {h.active_events || 0}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right font-semibold text-[#0F2044]">{h.cars_today || 0}</td>
                          <td className="px-6 py-4 text-right font-medium text-gray-600">{h.total_cars_served || 0}</td>
                          <td className="px-6 py-4 text-right text-sm text-gray-400">{h.total_valet_slots || "—"}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="6" className="px-6 py-12 text-center text-gray-500">
                          No hotels assigned to your account yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <>
            <h2 className="font-heading text-xl font-semibold text-[#0F2044] mb-4">Quick Links</h2>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-gray-100">
              <Link to="/owner/events" className="flex-1 p-4 flex items-center justify-between hover:bg-gray-50 transition">
                <div className="flex items-center gap-3">
                  <CalendarClock className="w-5 h-5 text-emerald-600" />
                  <span className="font-semibold text-gray-800 text-sm">Manage Events</span>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-400" />
              </Link>
              <Link to="/owner/cars" className="flex-1 p-4 flex items-center justify-between hover:bg-gray-50 transition">
                <div className="flex items-center gap-3">
                  <Car className="w-5 h-5 text-blue-600" />
                  <span className="font-semibold text-gray-800 text-sm">View Cars</span>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-400" />
              </Link>
              <Link to="/owner/incidents" className="flex-1 p-4 flex items-center justify-between hover:bg-gray-50 transition">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                  <span className="font-semibold text-gray-800 text-sm">Incidents</span>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-400" />
              </Link>
            </div>
          </>
        )}
      </div>
    </OwnerLayout>
  );
}
