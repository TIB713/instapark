import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import OwnerLayout from "@/components/layout/OwnerLayout";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  ArrowLeft, Building2, MapPin, Phone, Mail, Clock,
  Calendar, ShieldCheck, User, Users, Star, Car
} from "lucide-react";
import StatusBadge from "@/components/ui/StatusBadge";

export default function OwnerHotelDetail() {
  const { hid } = useParams();
  const [hotel, setHotel] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

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

  if (loading) {
    return (
      <OwnerLayout title="Hotel Detail">
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
          <div className="w-10 h-10 rounded-full border-4 border-[#1A3C6E] border-t-transparent animate-spin" />
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
      <div className="mb-6 fade-in-up">
        <Link to="/owner/hotels" className="inline-flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-900 transition mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to Hotels
        </Link>
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="flex gap-4 items-start">
            <div className="w-16 h-16 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0">
              <Building2 className="w-8 h-8 text-indigo-600" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="font-heading text-3xl font-bold text-[#0F2044]">{hotel.name}</h1>
                <StatusBadge status={hotel.is_active !== false ? "active" : "inactive"} />
              </div>
              <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
                <div className="flex items-center gap-1.5"><MapPin className="w-4 h-4 text-gray-400" />{hotel.city}, {hotel.state}</div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link to={`/provider/events?hotel_id=${hid}`} className="btn-primary-navy px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2">
              <Calendar className="w-4 h-4" /> View Events
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 fade-in-up">
        {/* Left Column: Info & Stats */}
        <div className="lg:col-span-1 space-y-6">
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
              <div className="bg-amber-50 rounded-xl p-4">
                <div className="text-xs font-semibold text-amber-600 uppercase tracking-wider">Driver Rating</div>
                <div className="font-heading text-2xl font-bold text-amber-700 mt-1 flex items-center gap-1">
                  {s.driver_avg_rating > 0 ? `${s.driver_avg_rating}★` : "—"}
                </div>
              </div>
              <div className="bg-indigo-50 rounded-xl p-4">
                <div className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">Valet Slots</div>
                <div className="font-heading text-2xl font-bold text-indigo-700 mt-1">{hotel.total_valet_slots || 0}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Team */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-heading text-lg font-bold text-[#0F2044] flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-indigo-500" /> Assigned Supervisors
              </h3>
              <span className="text-xs font-semibold bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">{supervisors.length} Total</span>
            </div>
            {supervisors.length === 0 ? (
              <div className="text-center py-8 text-sm text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-200">No supervisors assigned to this hotel.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

          <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-heading text-lg font-bold text-[#0F2044] flex items-center gap-2">
                <Users className="w-5 h-5 text-amber-500" /> Assigned Drivers
              </h3>
              <span className="text-xs font-semibold bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">{drivers.length} Total</span>
            </div>
            {drivers.length === 0 ? (
              <div className="text-center py-8 text-sm text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-200">No drivers assigned to this hotel.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
        </div>
      </div>
    </OwnerLayout>
  );
}
