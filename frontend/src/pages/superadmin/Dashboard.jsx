import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import SuperLayout from "@/components/layout/SuperLayout";
import { api, decodeJwt } from "@/lib/api";
import { Building2, Hotel, CalendarClock, Users, Car, Star, Wifi, WifiOff, TrendingUp, TrendingDown, Shield } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import StatCard from "@/components/ui/StatCard";

export default function Dashboard() {
  const nav = useNavigate();
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState([]);
  const [online, setOnline] = useState(true);
  const [activityRange, setActivityRange] = useState("week"); // "week" | "month" | "custom"
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const token = localStorage.getItem("superadmin_token");
  const name = decodeJwt(token)?.name || "Superadmin";

  const loadStats = async () => {
    try {
      const { data } = await api.get("/superadmin/stats");
      setStats(data);
      setOnline(true);
    } catch {
      setOnline(false);
    }
  };

  const loadActivity = async () => {
    try {
      const activityUrl = activityRange === "custom"
        ? `/superadmin/stats/activity?start=${customStart}&end=${customEnd}`
        : `/superadmin/stats/activity?days=${activityRange === "month" ? 30 : 7}`;
      const { data } = await api.get(activityUrl);
      setActivity(data || []);
    } catch {
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

  return (
    <SuperLayout title="Dashboard">
      <div className="mb-8">
        <h1 className="font-heading text-3xl sm:text-4xl font-bold text-[#0F2044]">Welcome, {name.split(" ")[0]}.</h1>
        <p className="text-gray-500 mt-1">Live overview of every provider, driver, and car on the platform.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5">
        <StatCard testid="stat-providers" label="Providers" to="/superadmin/providers"
          value={stats ? `${stats.active_providers}/${stats.total_providers}` : "—"}
          sub="active / total" icon={<Building2 className="w-5 h-5 text-[#1A3C6E]" />} accent="bg-[#1A3C6E]/10" />
        <StatCard testid="stat-events" label="Active Events" to="/superadmin/events?filter=active"
          value={stats?.active_events ?? "—"}
          sub={<span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500 pulse-dot inline-block" />running now</span>}
          icon={<CalendarClock className="w-5 h-5 text-emerald-600" />} accent="bg-emerald-50" />
        <StatCard testid="stat-drivers" label="Total Drivers" to="/superadmin/drivers"
          value={stats?.total_drivers ?? "—"}
          icon={<Users className="w-5 h-5 text-amber-600" />} accent="bg-amber-50" />
        <StatCard testid="stat-cars" label="Total Cars" to="/superadmin/cars"
          value={stats?.total_cars ?? "—"}
          icon={<Car className="w-5 h-5 text-rose-600" />} accent="bg-rose-50" />
        <StatCard testid="stat-rating" label="Platform Rating" to="/superadmin/events"
          value={stats?.platform_avg_rating ? `${stats.platform_avg_rating}★` : "—"}
          sub="platform average"
          icon={<Star className="w-5 h-5 text-amber-500" />} accent="bg-amber-50" />
        <StatCard testid="stat-rating-drv" label="Driver Rating" to="/superadmin/events"
          value={stats?.driver_avg_rating ? `${stats.driver_avg_rating}★` : "—"}
          sub="driver average"
          icon={<Star className="w-5 h-5 text-amber-500" />} accent="bg-amber-50" />
      </div>

      <div className="mt-6">
        <h2 className="font-heading text-lg font-semibold text-[#0F2044] mb-3">Today at a Glance</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="bg-white rounded-xl border border-gray-100 border-l-4 border-l-emerald-500 p-4">
            <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Events Today</div>
            <div className="mt-1 font-heading text-2xl font-bold text-[#0F2044]">{stats?.today_events ?? 0}</div>
            <div className="text-[10px] text-gray-400 mt-1">scheduled for today</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 border-l-4 border-l-blue-500 p-4">
            <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Total Cars Today</div>
            <div className="mt-1 font-heading text-2xl font-bold text-[#0F2044]">{stats?.today_cars ?? 0}</div>
            <div className="text-[10px] text-gray-400 mt-1">checked in today</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 border-l-4 border-l-indigo-500 p-4">
            <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Currently Parked</div>
            <div className="mt-1 font-heading text-2xl font-bold text-[#0F2044]">{stats?.today_parked ?? 0}</div>
            <div className="text-[10px] text-gray-400 mt-1">still in parking</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 border-l-4 border-l-amber-500 p-4">
            <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Pending Retrievals</div>
            <div className="mt-1 font-heading text-2xl font-bold text-[#0F2044]">{stats?.today_retrievals ?? 0}</div>
            <div className="text-[10px] text-gray-400 mt-1">waiting to be retrieved</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 border-l-4 border-l-emerald-500 p-4">
            <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Retrieved Today</div>
            <div className="mt-1 font-heading text-2xl font-bold text-[#0F2044]">{stats?.today_retrieved ?? 0}</div>
            <div className="text-[10px] text-gray-400 mt-1">successfully delivered</div>
          </div>
        </div>
      </div>

      <h2 className="font-heading text-xl font-semibold text-[#0F2044] mt-12 mb-4">Quick Navigation</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { to: "/superadmin/providers", t: "Manage Valet Providers", icon: <Building2 className="w-5 h-5" /> },
          { to: "/superadmin/hotels", t: "Manage Hotel Providers", icon: <Hotel className="w-5 h-5" /> },
          { to: "/superadmin/supervisors", t: "All Supervisors", icon: <Shield className="w-5 h-5" /> },
          { to: "/superadmin/drivers", t: "All Drivers", icon: <Users className="w-5 h-5" /> },
          { to: "/superadmin/events", t: "All Events", icon: <CalendarClock className="w-5 h-5" /> },
          { to: "/superadmin/cars", t: "All Cars", icon: <Car className="w-5 h-5" /> },
        ].map((q, i) => (
          <Link key={i} to={q.to} data-testid={`quick-${q.t.toLowerCase().replace(/\s/g, "-")}`}
            className="bg-white rounded-2xl shadow-card border border-gray-100 p-5 hover:bg-[#1A3C6E] hover:text-white transition group">
            <div className="w-10 h-10 rounded-xl bg-[#1A3C6E]/10 group-hover:bg-white/20 text-[#1A3C6E] group-hover:text-white flex items-center justify-center">
              {q.icon}
            </div>
            <div className="font-heading text-base font-semibold mt-3">{q.t}</div>
          </Link>
        ))}
      </div>

      <div className="mt-12">
        <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="font-heading text-xl font-semibold text-[#0F2044]">
              Platform Activity — {
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
                    className="px-2.5 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 outline-none focus:border-[#1A3C6E]"
                  />
                  <span className="text-gray-400 text-sm">to</span>
                  <input
                    type="date"
                    value={customEnd}
                    min={customStart || undefined}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={e => setCustomEnd(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 outline-none focus:border-[#1A3C6E]"
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
                  <Bar dataKey="checkins" fill="#1A3C6E" radius={[6, 6, 0, 0]} cursor="pointer" onClick={(data) => { if (data?.date) nav('/superadmin/cars?date=' + data.date); }} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </SuperLayout>
  );
}
