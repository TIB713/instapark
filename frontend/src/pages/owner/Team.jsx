import { useEffect, useState, useMemo } from "react";
import OwnerLayout from "@/components/layout/OwnerLayout";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Search, Users, Shield, User } from "lucide-react";
import SkeletonTable from "@/components/ui/SkeletonTable";
import EmptyState from "@/components/ui/EmptyState";
import StatusBadge from "@/components/ui/StatusBadge";

export default function OwnerTeam() {
  const [activeTab, setActiveTab] = useState("drivers");
  const [drivers, setDrivers] = useState([]);
  const [supervisors, setSupervisors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [dRes, sRes] = await Promise.all([
          api.get("/drivers"),
          api.get("/supervisors")
        ]);
        setDrivers(Array.isArray(dRes.data) ? dRes.data : []);
        setSupervisors(Array.isArray(sRes.data) ? sRes.data : []);
      } catch (err) {
        toast.error("Failed to load team data");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const filteredDrivers = useMemo(() => {
    return drivers.filter(d => !q || (d.name?.toLowerCase().includes(q.toLowerCase()) || d.phone?.includes(q)));
  }, [drivers, q]);

  const filteredSupervisors = useMemo(() => {
    return supervisors.filter(s => !q || (s.name?.toLowerCase().includes(q.toLowerCase()) || s.phone?.includes(q)));
  }, [supervisors, q]);

  return (
    <OwnerLayout title="Team">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold text-[#0F2044]">Team Management</h1>
        <p className="text-gray-500 text-sm">View your registered drivers and supervisors.</p>
      </div>

      <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden fade-in-up">
        <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex bg-white rounded-xl p-1 border border-gray-200">
            <button
              onClick={() => setActiveTab("drivers")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${activeTab === "drivers" ? "bg-[#0F2044] text-white shadow" : "text-gray-500 hover:text-gray-900 hover:bg-gray-50"}`}
            >
              <User className="w-4 h-4" /> Drivers ({drivers.length})
            </button>
            <button
              onClick={() => setActiveTab("supervisors")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${activeTab === "supervisors" ? "bg-[#0F2044] text-white shadow" : "text-gray-500 hover:text-gray-900 hover:bg-gray-50"}`}
            >
              <Shield className="w-4 h-4" /> Supervisors ({supervisors.length})
            </button>
          </div>
          
          <div className="relative w-full max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder={`Search ${activeTab}...`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm rounded-xl border border-gray-200 focus:border-[#1A3C6E] focus:ring-1 focus:ring-[#1A3C6E] outline-none"
            />
          </div>
        </div>

        {loading ? (
          <SkeletonTable rows={5} columns={4} />
        ) : activeTab === "drivers" ? (
          filteredDrivers.length === 0 ? (
            <EmptyState theme="owner" icon={<Users className="w-8 h-8" />} title="No Drivers" description={q ? "No drivers match your search." : "No drivers found."} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-[#0F2044]/[0.04] text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100">
                    <th className="px-6 py-4">Name</th>
                    <th className="px-6 py-4">Phone</th>
                    <th className="px-6 py-4">Assigned Hotel</th>
                    <th className="px-6 py-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredDrivers.map(d => (
                    <tr key={d.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 font-semibold text-[#0F2044]">{d.name}</td>
                      <td className="px-6 py-4 text-gray-600">{d.phone || "—"}</td>
                      <td className="px-6 py-4 text-gray-600">{d.hotel_name || "—"}</td>
                      <td className="px-6 py-4 flex items-center gap-2">
                        <StatusBadge status={(d.is_verified && d.is_active !== false) ? "active" : "inactive"} />
                        <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded border ${d.is_verified ? "text-emerald-600 bg-emerald-50 border-emerald-200" : "text-amber-600 bg-amber-50 border-amber-200"}`}>
                          {d.is_verified ? "Verified" : "Unverified"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          filteredSupervisors.length === 0 ? (
            <EmptyState theme="owner" icon={<Shield className="w-8 h-8" />} title="No Supervisors" description={q ? "No supervisors match your search." : "No supervisors found."} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-[#0F2044]/[0.04] text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100">
                    <th className="px-6 py-4">Name</th>
                    <th className="px-6 py-4">Phone / Email</th>
                    <th className="px-6 py-4">Assigned Hotel</th>
                    <th className="px-6 py-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredSupervisors.map(s => (
                    <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 font-semibold text-[#0F2044]">{s.name}</td>
                      <td className="px-6 py-4 text-gray-600">
                        <div>{s.phone || "—"}</div>
                        <div className="text-xs text-gray-400 mt-0.5">{s.email || "—"}</div>
                      </td>
                      <td className="px-6 py-4 text-gray-600">{s.hotel_name || "—"}</td>
                      <td className="px-6 py-4 flex items-center gap-2">
                        <StatusBadge status={(s.is_verified && s.is_active !== false) ? "active" : "inactive"} />
                        <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded border ${s.is_verified ? "text-emerald-600 bg-emerald-50 border-emerald-200" : "text-amber-600 bg-amber-50 border-amber-200"}`}>
                          {s.is_verified ? "Verified" : "Unverified"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </OwnerLayout>
  );
}
