import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import OwnerLayout from "@/components/layout/OwnerLayout";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  ArrowLeft, Calendar, MapPin, Clock, Users,
  Car, Info, Hash, Star, MessageSquare
} from "lucide-react";

export default function OwnerEventDetail() {
  const params = useParams();
  const id = params.id || params.eid;
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");
  const [feedback, setFeedback] = useState([]);
  const [loadingFeedback, setLoadingFeedback] = useState(false);
  const [feedbackLoaded, setFeedbackLoaded] = useState(false);

  useEffect(() => {
    if (activeTab === "feedback" && !feedbackLoaded) {
      setLoadingFeedback(true);
      api.get(`/events/${id}/feedback`)
        .then(res => {
          setFeedback(res.data);
          setFeedbackLoaded(true);
        })
        .catch(() => toast.error("Failed to load feedback"))
        .finally(() => setLoadingFeedback(false));
    }
  }, [activeTab, id, feedbackLoaded]);

  useEffect(() => {
    api.get(`/events/${id}`)
      .then(res => setEvent(res.data))
      .catch(() => toast.error("Failed to load event details"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <OwnerLayout title="Event Detail">
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
          <div className="w-10 h-10 rounded-full border-4 border-[#1A3C6E] border-t-transparent animate-spin" />
        </div>
      </OwnerLayout>
    );
  }

  if (!event) {
    return (
      <OwnerLayout title="Event Detail">
        <div className="text-center py-20 text-gray-500">Event not found.</div>
      </OwnerLayout>
    );
  }

  return (
    <OwnerLayout title="Event Detail">
      <div className="mb-6 fade-in-up">
        <Link to="/provider/events" className="inline-flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-900 transition mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to Events
        </Link>
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-heading text-3xl font-bold text-[#0F2044]">{event.name}</h1>
              {event.status === "active" ? (
                <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 pulse-dot" /> Active
                </span>
              ) : (
                <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">
                  Closed
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-3 text-sm text-gray-600 font-medium">
              {event.venue && <div className="flex items-center gap-1.5"><MapPin className="w-4 h-4 text-gray-400" /> {event.venue}</div>}
              {event.date && <div className="flex items-center gap-1.5"><Calendar className="w-4 h-4 text-gray-400" /> {event.date}</div>}
              {event.start_time && event.end_time && (
                <div className="flex items-center gap-1.5"><Clock className="w-4 h-4 text-gray-400" /> {event.start_time} - {event.end_time}</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-2 mb-6 inline-flex flex-wrap gap-1 fade-in-up">
        {["overview", "zones", "gates", "feedback"].map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold capitalize transition ${
              activeTab === t ? "bg-[#0F2044] text-white shadow-sm" : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
            }`}>
            {t.replace("_", " ")}
          </button>
        ))}
      </div>

      <div className="fade-in-up">
        {activeTab === "overview" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-6">
              <h3 className="font-heading text-lg font-bold text-[#0F2044] mb-4 flex items-center gap-2">
                <Info className="w-5 h-5 text-indigo-500" /> Details
              </h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between py-2 border-b border-gray-50">
                  <span className="text-gray-500 text-sm">Provider</span>
                  <span className="text-sm font-semibold text-gray-900">{event.provider_name || "—"}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-gray-50">
                  <span className="text-gray-500 text-sm">Hotel</span>
                  <span className="text-sm font-semibold text-gray-900">{event.hotel_name || "—"}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-gray-50">
                  <span className="text-gray-500 text-sm">Max Capacity</span>
                  <span className="text-sm font-semibold text-gray-900">{event.max_cars || "—"}</span>
                </div>

              </div>
            </div>
            
            <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-6">
              <h3 className="font-heading text-lg font-bold text-[#0F2044] mb-4 flex items-center gap-2">
                <Car className="w-5 h-5 text-blue-500" /> Stats
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-xl p-4">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Cars Checked In</div>
                  <div className="font-heading text-2xl font-bold text-[#0F2044] mt-1">{event.cars_count || 0}</div>
                </div>
                <div className="bg-emerald-50 rounded-xl p-4">
                  <div className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Currently Parked</div>
                  <div className="font-heading text-2xl font-bold text-emerald-700 mt-1">{event.currently_parked || 0}</div>
                </div>
                <div className="bg-blue-50 rounded-xl p-4">
                  <div className="text-xs font-semibold text-blue-600 uppercase tracking-wider">Pending Retrievals</div>
                  <div className="font-heading text-2xl font-bold text-blue-700 mt-1">{event.pending_retrievals || 0}</div>
                </div>
                <div className="bg-indigo-50 rounded-xl p-4">
                  <div className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">Completed Retrievals</div>
                  <div className="font-heading text-2xl font-bold text-indigo-700 mt-1">{event.completed_retrievals || 0}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "zones" && (
          <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-6">
            <h3 className="font-heading text-lg font-bold text-[#0F2044] mb-4">Parking Zones</h3>
            {event.zones && event.zones.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {event.zones.map((z, i) => (
                  <div key={i} className="p-4 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-between">
                    <span className="font-semibold text-gray-900">{z.name}</span>
                    <span className="text-xs font-medium bg-white px-2 py-1 rounded border border-gray-200 text-gray-600">{z.slots} Slots</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">No zones defined.</div>
            )}
          </div>
        )}

        {activeTab === "gates" && (
          <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-6">
            <h3 className="font-heading text-lg font-bold text-[#0F2044] mb-4">Gates</h3>
            {event.gates && event.gates.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {event.gates.map((g, i) => (
                  <div key={i} className="px-4 py-2 rounded-lg bg-indigo-50 text-indigo-700 font-semibold border border-indigo-100">
                    {g}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">No gates defined.</div>
            )}
          </div>
        )}

        {activeTab === "feedback" && (
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden flex-1 relative mb-10">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <h3 className="font-heading font-bold text-[#0F2044] flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-indigo-500" />
                Guest Feedback
              </h3>
            </div>
            <div className="p-4 sm:p-6 flex flex-col gap-4 bg-gray-50/20">
              {loadingFeedback ? (
                <div className="py-20 flex flex-col items-center justify-center">
                  <div className="w-8 h-8 border-4 border-[#0F2044]/20 border-t-[#0F2044] rounded-full animate-spin mb-3"></div>
                  <p className="text-gray-400 font-medium text-sm">Loading feedback...</p>
                </div>
              ) : feedback.length === 0 ? (
                <div className="text-center py-20 bg-white border border-gray-100 rounded-2xl shadow-sm">
                  <div className="w-12 h-12 bg-gray-50 rounded-xl flex items-center justify-center mx-auto mb-3">
                    <MessageSquare className="w-6 h-6 text-gray-300" />
                  </div>
                  <p className="text-gray-500 font-semibold">No feedback yet</p>
                  <p className="text-gray-400 text-sm mt-1">When guests submit ratings, they will appear here</p>
                </div>
              ) : (
                feedback.map(item => (
                  <div key={item.id} className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-gray-100 text-gray-600 border border-gray-200">{item.plate}</span>
                          <span className="font-bold text-gray-800">{item.guest_name}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          {[1, 2, 3, 4, 5].map(star => (
                            <Star key={star} className={`w-3.5 h-3.5 ${star <= item.stars ? 'text-amber-400 fill-amber-400' : 'text-gray-200'}`} />
                          ))}
                          <span className="text-xs text-gray-400 ml-2">
                            {new Date(item.created_at).toLocaleString(undefined, {
                                month: 'short', day: 'numeric',
                                hour: 'numeric', minute: '2-digit'
                            })}
                          </span>
                        </div>
                      </div>
                      {item.driver_name && (
                        <div className="text-right flex flex-col items-end">
                          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Retrieval Driver</span>
                          <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700 bg-gray-50 px-2 py-1 rounded-lg border border-gray-100">
                            <Car className="w-3.5 h-3.5 text-gray-400" />
                            {item.driver_name}
                          </div>
                        </div>
                      )}
                    </div>

                    {item.issues && Object.values(item.issues).some(Boolean) && (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {item.issues.extra_money_asked && <span className="px-2 py-1 bg-red-50 text-red-600 border border-red-100 rounded-full text-xs font-semibold">Extra money asked</span>}
                        {item.issues.misbehaved && <span className="px-2 py-1 bg-red-50 text-red-600 border border-red-100 rounded-full text-xs font-semibold">Misbehaved</span>}
                        {item.issues.late_arrival && <span className="px-2 py-1 bg-amber-50 text-amber-600 border border-amber-100 rounded-full text-xs font-semibold">Late arrival</span>}
                        {item.issues.vehicle_damaged && <span className="px-2 py-1 bg-red-50 text-red-600 border border-red-100 rounded-full text-xs font-semibold">Vehicle damaged</span>}
                        {item.issues.unauthorized_personal_use && <span className="px-2 py-1 bg-red-50 text-red-600 border border-red-100 rounded-full text-xs font-semibold">Unauthorized use</span>}
                      </div>
                    )}

                    {item.comment && (
                      <div className="bg-gray-50 p-3.5 rounded-xl border border-gray-100 text-sm text-gray-600 italic">
                        "{item.comment}"
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </OwnerLayout>
  );
}
