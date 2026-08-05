import { useEffect, useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import OwnerLayout from "@/components/layout/OwnerLayout";
import { api } from "@/lib/api";
import { Hotel, Search, MapPin } from "lucide-react";
import SkeletonTable from "@/components/ui/SkeletonTable";
import EmptyState from "@/components/ui/EmptyState";
import StatusBadge from "@/components/ui/StatusBadge";

export default function OwnerHotels() {
  const [hotels, setHotels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const nav = useNavigate();

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await api.get("/hotels");
        setHotels(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const filtered = useMemo(() => {
    return hotels.filter(h =>
      !search || h.name.toLowerCase().includes(search.toLowerCase()) || h.city?.toLowerCase().includes(search.toLowerCase())
    );
  }, [hotels, search]);

  return (
    <OwnerLayout title="Hotels">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-[#0F2044]">Hotels</h1>
          <p className="text-gray-500 text-sm mt-1">View and manage your hotel operations.</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden fade-in-up">
        <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
          <div className="relative w-full max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by hotel name or city..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm rounded-xl border border-gray-200 focus:border-[#1A3C6E] focus:ring-1 focus:ring-[#1A3C6E] outline-none"
            />
          </div>
          <span className="text-xs font-semibold text-gray-500 bg-gray-200/50 px-2.5 py-1 rounded-full ml-4 shrink-0">
            {filtered.length} Hotels
          </span>
        </div>

        {loading ? (
          <SkeletonTable rows={5} columns={4} />
        ) : filtered.length === 0 ? (
          <EmptyState theme="owner" icon={<Hotel className="w-8 h-8" />} title="No Hotels Found" description={search ? "Try adjusting your search filters." : "You do not have any hotels assigned to your account."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#0F2044]/[0.04] text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100">
                  <th className="px-6 py-4">Hotel Name</th>
                  <th className="px-6 py-4">Location</th>
                  <th className="px-6 py-4">Valet Slots</th>
                  <th className="px-6 py-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm">
                {filtered.map(hotel => (
                  <tr
                    key={hotel.id}
                    onClick={() => nav(`/provider/hotels/${hotel.id}`)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="font-semibold text-gray-900">{hotel.name}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{hotel.address}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5 text-gray-600">
                        <MapPin className="w-3.5 h-3.5 text-gray-400" />
                        {hotel.city}, {hotel.state}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-700">{hotel.total_valet_slots}</div>
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={hotel.is_active !== false ? "active" : "inactive"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </OwnerLayout>
  );
}
