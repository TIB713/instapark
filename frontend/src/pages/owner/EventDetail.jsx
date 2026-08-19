import { useEffect, useState, useMemo, useRef } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import OwnerLayout from "@/components/layout/OwnerLayout";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowLeft, Calendar, MapPin, Clock, Users,
  Car, Info, Star, MessageSquare, CheckCircle2,
  AlertTriangle, Search, ChevronDown, Edit2, QrCode, Download
} from "lucide-react";
import StatusBadge from "@/components/ui/StatusBadge";
import { fmtTime, fmtDate, fmtDateTime } from "@/lib/time";

import { useScrollToFirstError } from "../../hooks/useScrollToFirstError";

const FEEDBACK_QUESTIONS = [
  { key: 'extra_money_asked', label: 'Did the driver ask for extra money?' },
  { key: 'misbehaved', label: 'Was the driver rude or misbehaving?' },
  { key: 'late_arrival', label: 'Did the driver arrive late to retrieve your car?' },
  { key: 'vehicle_damaged', label: 'Was your vehicle damaged?' },
  { key: 'unauthorized_personal_use', label: 'Did you notice the driver using your vehicle without permission?' },
];

export default function OwnerEventDetail() {
  const params = useParams();
  const id = params.id || params.eid;
  const eid = id;
  const nav = useNavigate();
  const fieldRefs = useRef({});

  const scrollToFirstError = useScrollToFirstError(["name", "venue", "date", "end_date", "max_cars", "gate_timer_minutes"], fieldRefs);
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("info");
  const [qrModalCar, setQrModalCar] = useState(null);

  const downloadQrSvg = () => {
    const svg = document.getElementById("guest-qr-svg");
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      canvas.width = 300;
      canvas.height = 300;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, 300, 300);
      const a = document.createElement("a");
      a.download = `QR_${qrModalCar.plate}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    };
    img.src = "data:image/svg+xml;base64," + btoa(svgData);
  };
  
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", venue: "", date: "", end_date: "", start_time: "", end_time: "", max_cars: "", gate_timer_minutes: "", allow_instant_park: false, zones: [], gates: "" });
  const [editErrors, setEditErrors] = useState({});
  const isHotelDaily = event?.event_type === "hotel_daily";
  
  // Data states
  const [feedback, setFeedback] = useState([]);
  const [loadingFeedback, setLoadingFeedback] = useState(false);
  const [feedbackLoaded, setFeedbackLoaded] = useState(false);

  const [drivers, setDrivers] = useState([]);
  const [driversLoading, setDriversLoading] = useState(false);
  const [driversLoaded, setDriversLoaded] = useState(false);

  const [supervisors, setSupervisors] = useState([]);
  const [supsLoading, setSupsLoading] = useState(false);
  const [supsLoaded, setSupsLoaded] = useState(false);

  const [cars, setCars] = useState([]);
  const [carsLoading, setCarsLoading] = useState(false);
  const [carsLoaded, setCarsLoaded] = useState(false);

  const [incidents, setIncidents] = useState([]);
  const [incidentsLoading, setIncidentsLoading] = useState(false);
  const [incidentsLoaded, setIncidentsLoaded] = useState(false);

  // UI states
  const [driverSearch, setDriverSearch] = useState("");
  const [driversPage, setDriversPage] = useState(1);

  const [supervisorSearch, setSupervisorSearch] = useState("");
  const [supervisorsPage, setSupervisorsPage] = useState(1);

  const [carSearch, setCarSearch] = useState("");

  const [incidentSearch, setIncidentSearch] = useState("");
  const [incidentsPage, setIncidentsPage] = useState(1);

  useEffect(() => { setDriversPage(1); }, [driverSearch]);
  useEffect(() => { setSupervisorsPage(1); }, [supervisorSearch]);
  useEffect(() => { setIncidentsPage(1); }, [incidentSearch]);

  const load = () => {
    api.get(`/events/${id}`)
      .then(res => {
        const e = res.data;
        setEvent(e);
        setEditForm({
          name: e.name || "",
          venue: e.venue || "",
          date: e.date || "",
          end_date: e.end_date || "",
          start_time: e.start_time || "",
          end_time: e.end_time || "",
          max_cars: e.max_cars || "",
          gate_timer_minutes: e.gate_timer_minutes || "",
          allow_instant_park: !!e.allow_instant_park,
          zones: e.zones || [],
          gates: e.gates ? e.gates.join(", ") : ""
        });
      })
      .catch(() => toast.error("Failed to load event details"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [id]);

  useEffect(() => {
    if (activeTab === "feedback" && !feedbackLoaded && event) {
      setLoadingFeedback(true);
      api.get(`/events/${id}/feedback`)
        .then(res => {
          setFeedback(res.data);
          setFeedbackLoaded(true);
        })
        .catch(() => toast.error("Failed to load feedback"))
        .finally(() => setLoadingFeedback(false));
    }
  }, [activeTab, id, feedbackLoaded, event]);

  useEffect(() => {
    if (activeTab === "drivers" && !driversLoaded && event) {
      setDriversLoading(true);
      api.get(`/events/${id}/drivers`)
        .then(res => {
          setDrivers(res.data);
          setDriversLoaded(true);
        })
        .catch(() => toast.error("Failed to load drivers"))
        .finally(() => setDriversLoading(false));
    }
  }, [activeTab, id, driversLoaded, event]);

  useEffect(() => {
    if (activeTab === "supervisors" && !supsLoaded && event) {
      setSupsLoading(true);
      api.get(`/events/${id}/supervisors`)
        .then(res => {
          setSupervisors(res.data);
          setSupsLoaded(true);
        })
        .catch(() => toast.error("Failed to load supervisors"))
        .finally(() => setSupsLoading(false));
    }
  }, [activeTab, id, supsLoaded, event]);

  useEffect(() => {
    if (activeTab === "cars" && !carsLoaded && event) {
      setCarsLoading(true);
      api.get(`/superadmin/events/${id}/cars`)
        .then(res => {
          setCars(res.data);
          setCarsLoaded(true);
        })
        .catch(() => toast.error("Failed to load cars"))
        .finally(() => setCarsLoading(false));
    }
  }, [activeTab, id, carsLoaded, event]);

  useEffect(() => {
    if (activeTab === "incidents" && !incidentsLoaded && event) {
      setIncidentsLoading(true);
      api.get(`/incidents/event/${id}`)
        .then(res => {
          setIncidents(res.data);
          setIncidentsLoaded(true);
        })
        .catch(() => toast.error("Failed to load incidents"))
        .finally(() => setIncidentsLoading(false));
    }
  }, [activeTab, id, incidentsLoaded, event]);


  const filteredDrivers = useMemo(() =>
    drivers.filter(d =>
      !driverSearch || `${d.name} ${d.employee_id}`.toLowerCase().includes(driverSearch.toLowerCase())
    ), [drivers, driverSearch]);
  const paginatedDrivers = filteredDrivers.slice((driversPage - 1) * 10, driversPage * 10);

  const filteredSupervisors = useMemo(() =>
    supervisors.filter(s =>
      !supervisorSearch || `${s.name} ${s.email}`.toLowerCase().includes(supervisorSearch.toLowerCase())
    ), [supervisors, supervisorSearch]);
  const paginatedSupervisors = filteredSupervisors.slice((supervisorsPage - 1) * 10, supervisorsPage * 10);

  const filteredCars = useMemo(() =>
    cars.filter(c => 
      !carSearch || `${c.plate} ${c.make} ${c.color} ${c.check_in_driver_name} ${c.retrieval_driver_name}`.toLowerCase().includes(carSearch.toLowerCase())
    ), [cars, carSearch]);

  const handleEditEvent = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!isHotelDaily) {
      if (!editForm.name?.trim()) errs.name = "Event name cannot be empty";
      if (!editForm.venue?.trim()) errs.venue = "Venue cannot be empty";
      if (!editForm.date?.trim()) errs.date = "Date is required";
      if (!editForm.max_cars || parseInt(editForm.max_cars) < 1) errs.max_cars = "Max cars must be at least 1";
      const totalSlots = editForm.zones.reduce((sum, z) => sum + (parseInt(z.slots) || 0), 0);
      if (totalSlots > editForm.max_cars) {
        errs.max_cars = `Total slots (${totalSlots}) cannot exceed max cars (${editForm.max_cars}). Reduce zone slots.`;
      }
    } else {
      if (editForm.gate_timer_minutes && parseInt(editForm.gate_timer_minutes) < 1) errs.gate_timer_minutes = "Gate timer must be at least 1";
    }
    setEditErrors(errs);
    if (Object.keys(errs).length > 0) {
      scrollToFirstError(errs);
      return;
    }
    try {
      let body = {};
      const parsedGates = editForm.gates.split(",").map(g => g.trim()).filter(g => g);
      if (isHotelDaily) {
        body = {
          venue: editForm.venue?.trim(),
          start_time: editForm.start_time,
          end_time: editForm.end_time,
          gates: parsedGates,
          gate_timer_minutes: parseInt(editForm.gate_timer_minutes) || 5,
          allow_instant_park: editForm.allow_instant_park
        };
      } else {
        body = {
          ...editForm,
          gate_timer_minutes: editForm.gate_timer_minutes ? parseInt(editForm.gate_timer_minutes) : null,
          zones: editForm.zones.filter(z => z.name.trim()),
          gates: parsedGates
        };
      }
      await api.patch(`/events/${eid}`, body);
      toast.success("Event updated successfully");
      setEditOpen(false); setEditErrors({});
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to update event");
    }
  };

  const filteredIncidents = useMemo(() =>
    incidents.filter(i =>
      !incidentSearch || i.description?.toLowerCase().includes(incidentSearch.toLowerCase()) ||
      i.plate?.toLowerCase().includes(incidentSearch.toLowerCase())
    ), [incidents, incidentSearch]);
  const paginatedIncidents = filteredIncidents.slice((incidentsPage - 1) * 10, incidentsPage * 10);

  const formatEventDate = (dateStr) => {
    if (!dateStr) return "";
    try {
      return fmtDate(`${dateStr}T00:00:00`);
    } catch {
      return dateStr;
    }
  };

  const eventSecondaryInfo = useMemo(() => {
    if (!event) return "";
    const datePart =
      event.end_date && event.end_date !== event.date
        ? `${formatEventDate(event.date)} – ${formatEventDate(event.end_date)}`
        : formatEventDate(event.date);
    const timePart =
      event.start_time && event.end_time
        ? `${event.start_time.slice(0, 5)} – ${event.end_time.slice(0, 5)}`
        : null;
    return [datePart, timePart].filter(Boolean).join(" · ");
  }, [event]);

  if (loading) {
    return (
      <OwnerLayout title="Event Detail">
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
          <div className="w-10 h-10 rounded-full border-4 border-[#1A3C6E] border-t-transparent animate-spin" />
        </div>
  
      {qrModalCar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in" onClick={() => setQrModalCar(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-6 text-center border-b border-gray-100">
              <h3 className="font-heading text-xl font-bold text-[#0F2044] uppercase">{qrModalCar.plate}</h3>
              <p className="text-gray-500 text-sm">{qrModalCar.guest_name || "Guest"}</p>
            </div>
            <div className="p-8 flex flex-col items-center">
              {qrModalCar.retrieval_token ? (
                <>
                  <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                    <QRCodeSVG id="guest-qr-svg" value={`${window.location.origin}/r/${qrModalCar.retrieval_token}`} size={200} />
                  </div>
                  {qrModalCar.checkin_code && (
                    <div className="mt-6 font-mono text-3xl font-bold text-gray-700 tracking-[0.2em]">
                      {qrModalCar.checkin_code}
                    </div>
                  )}
                  <p className="text-xs text-gray-400 mt-2">Scan to retrieve or present code</p>
                </>
              ) : (
                <p className="text-gray-500 text-center py-8">QR not available for this check-in</p>
              )}
            </div>
            <div className="p-4 bg-gray-50 flex gap-3">
              <button onClick={() => setQrModalCar(null)} className="flex-1 py-2.5 rounded-xl font-bold text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 transition-colors">
                Close
              </button>
              {qrModalCar.retrieval_token && (
                <button onClick={downloadQrSvg} className="flex-1 py-2.5 rounded-xl font-bold text-white bg-[#1A3C6E] hover:bg-[#0F2044] transition-colors flex items-center justify-center gap-2">
                  <Download className="w-4 h-4" /> Download
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </OwnerLayout>

    );
  }

  if (!event) {
    return (
      <OwnerLayout title="Event Detail">
        <div className="text-center py-20 text-gray-500">Event not found.</div>
  
      {qrModalCar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in" onClick={() => setQrModalCar(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-6 text-center border-b border-gray-100">
              <h3 className="font-heading text-xl font-bold text-[#0F2044] uppercase">{qrModalCar.plate}</h3>
              <p className="text-gray-500 text-sm">{qrModalCar.guest_name || "Guest"}</p>
            </div>
            <div className="p-8 flex flex-col items-center">
              {qrModalCar.retrieval_token ? (
                <>
                  <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                    <QRCodeSVG id="guest-qr-svg" value={`${window.location.origin}/r/${qrModalCar.retrieval_token}`} size={200} />
                  </div>
                  {qrModalCar.checkin_code && (
                    <div className="mt-6 font-mono text-3xl font-bold text-gray-700 tracking-[0.2em]">
                      {qrModalCar.checkin_code}
                    </div>
                  )}
                  <p className="text-xs text-gray-400 mt-2">Scan to retrieve or present code</p>
                </>
              ) : (
                <p className="text-gray-500 text-center py-8">QR not available for this check-in</p>
              )}
            </div>
            <div className="p-4 bg-gray-50 flex gap-3">
              <button onClick={() => setQrModalCar(null)} className="flex-1 py-2.5 rounded-xl font-bold text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 transition-colors">
                Close
              </button>
              {qrModalCar.retrieval_token && (
                <button onClick={downloadQrSvg} className="flex-1 py-2.5 rounded-xl font-bold text-white bg-[#1A3C6E] hover:bg-[#0F2044] transition-colors flex items-center justify-center gap-2">
                  <Download className="w-4 h-4" /> Download
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </OwnerLayout>

    );
  }

  return (
    <OwnerLayout title="Event Detail">
      <Link to="/provider/events" className="inline-flex items-center gap-1.5 text-sm font-medium text-[#1A3C6E] hover:text-[#0F2044] mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Events
      </Link>

      <div className="bg-[#0F2044] rounded-2xl overflow-hidden shadow-card mb-6 fade-in-up">
        <div className="px-4 sm:px-8 pt-4 sm:pt-8 pb-4 sm:pb-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex items-start gap-4 min-w-0">
              <span className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center text-2xl shrink-0 shadow-lg">🎟️</span>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h1 className="font-heading text-2xl font-bold text-white truncate">{event.name}</h1>
                  {event.status === "active" ? (
                    <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-dot" /> Active
                    </span>
                  ) : (
                    <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-500/20 text-gray-300 border border-gray-400/30">
                      Closed
                    </span>
                  )}
                </div>
                <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mt-0.5">{event.venue || "—"}</p>
                <p className="text-white/60 text-xs mt-1">{eventSecondaryInfo}</p>
              </div>
            </div>
            {!editOpen && (
              <button
                onClick={() => setEditOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 text-white text-xs font-bold hover:bg-white/20 transition-all"
              >
                <Edit2 className="w-3.5 h-3.5" /> Edit
              </button>
            )}
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex bg-black/20 border-t-2 border-amber-400/20 overflow-x-auto">
          {[
            { id: "info", label: "Info", icon: Info },
            { id: "drivers", label: "Drivers", icon: Users },
            { id: "supervisors", label: "Supervisors", icon: CheckCircle2 },
            { id: "cars", label: "Cars", icon: Car },
            { id: "incidents", label: "Incidents", icon: AlertTriangle },
            { id: "feedback", label: "Feedback", icon: MessageSquare }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3 sm:px-6 py-3 sm:py-3.5 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap border-b-[3px] ${activeTab === tab.id
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

      <div className="fade-in-up">
        {activeTab === "info" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-6">
                <h3 className="font-heading text-lg font-bold text-[#0F2044] mb-4 flex items-center gap-2">
                  <Info className="w-5 h-5 text-indigo-500" /> Details
                </h3>
                {editOpen ? (
                  <form onSubmit={handleEditEvent} className="space-y-4">
                    <div className="grid grid-cols-1 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Event Name {isHotelDaily ? "" : <span className="text-red-500">*</span>}</label>
                        {isHotelDaily ? (
                          <div className="px-4 py-2 bg-gray-50 rounded-xl border border-gray-100 text-sm font-semibold text-gray-700">{editForm.name}</div>
                        ) : (
                          <input ref={el => { if (fieldRefs.current) fieldRefs.current.name = el; }} 
                            type="text"
                            value={editForm.name}
                            onChange={(e) => { setEditForm({ ...editForm, name: e.target.value}); if (editErrors.name) setEditErrors(prev => ({ ...prev, name: undefined })); }}
                            className={`w-full px-4 py-2 rounded-xl border ${editErrors.name ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`}
                          />
                        )}
                        { editErrors.name && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.name}</p> }
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Venue {isHotelDaily ? "" : <span className="text-red-500">*</span>}</label>
                        <input ref={el => { if (fieldRefs.current) fieldRefs.current.venue = el; }} 
                          type="text"
                          value={editForm.venue}
                          onChange={(e) => { setEditForm({ ...editForm, venue: e.target.value}); if (editErrors.venue) setEditErrors(prev => ({ ...prev, venue: undefined })); }}
                          className={`w-full px-4 py-2 rounded-xl border ${editErrors.venue ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`}
                        />
                        { editErrors.venue && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.venue}</p> }
                      </div>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Date {isHotelDaily ? "" : <span className="text-red-500">*</span>}</label>
                          {isHotelDaily ? (
                            <div className="px-4 py-2 bg-gray-50 rounded-xl border border-gray-100 text-sm font-semibold text-gray-700">{editForm.date}</div>
                          ) : (
                            <input ref={el => { if (fieldRefs.current) fieldRefs.current.date = el; }} 
                              type="date"
                              value={editForm.date}
                              onChange={(e) => { setEditForm({ ...editForm, date: e.target.value}); if (editErrors.date) setEditErrors(prev => ({ ...prev, date: undefined })); }}
                              className={`w-full px-4 py-2 rounded-xl border ${editErrors.date ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`}
                            />
                          )}
                          { editErrors.date && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.date}</p> }
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">End Date</label>
                          {isHotelDaily ? (
                            <div className="px-4 py-2 bg-gray-50 rounded-xl border border-gray-100 text-sm font-semibold text-gray-700">{editForm.end_date || "—"}</div>
                          ) : (
                            <input ref={el => { if (fieldRefs.current) fieldRefs.current.end_date = el; }} 
                              type="date"
                              value={editForm.end_date}
                              onChange={(e) => { setEditForm({ ...editForm, end_date: e.target.value}); if (editErrors.end_date) setEditErrors(prev => ({ ...prev, end_date: undefined })); }}
                              className={`w-full px-4 py-2 rounded-xl border ${editErrors.end_date ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`}
                            />
                          )}
                          { editErrors.end_date && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.end_date}</p> }
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Start Time</label>
                          <input
                            type="time"
                            value={editForm.start_time}
                            onChange={(e) => { setEditForm({ ...editForm, start_time: e.target.value}); if (editErrors.start_time) setEditErrors(prev => ({ ...prev, start_time: undefined })); }}
                            className={`w-full px-4 py-2 rounded-xl border ${editErrors.start_time ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`}
                          />
                          { editErrors.start_time && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.start_time}</p> }
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">End Time</label>
                          <input
                            type="time"
                            value={editForm.end_time}
                            onChange={(e) => { setEditForm({ ...editForm, end_time: e.target.value}); if (editErrors.end_time) setEditErrors(prev => ({ ...prev, end_time: undefined })); }}
                            className={`w-full px-4 py-2 rounded-xl border ${editErrors.end_time ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`}
                          />
                          { editErrors.end_time && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.end_time}</p> }
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Max Cars</label>
                          {isHotelDaily ? (
                            <div className="px-4 py-2 bg-gray-50 rounded-xl border border-gray-100 text-sm font-semibold text-gray-700">{editForm.max_cars || "—"}</div>
                          ) : (
                            <input ref={el => { if (fieldRefs.current) fieldRefs.current.max_cars = el; }} 
                              type="number"
                              min={1}
                              value={editForm.max_cars}
                              onChange={(e) => { setEditForm({ ...editForm, max_cars: e.target.value}); if (editErrors.max_cars) setEditErrors(prev => ({ ...prev, max_cars: undefined })); }}
                              className={`w-full px-4 py-2 rounded-xl border ${editErrors.max_cars ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`}
                            />
                          )}
                          { editErrors.max_cars && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.max_cars}</p> }
                        </div>
                        <div>
                          <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Gate Wait Timer (minutes)</label>
                          <input ref={el => { if (fieldRefs.current) fieldRefs.current.gate_timer_minutes = el; }} 
                            type="number"
                            min="1"
                            max="30"
                            value={editForm.gate_timer_minutes}
                            onChange={(e) => { setEditForm({ ...editForm, gate_timer_minutes: e.target.value}); if (editErrors.gate_timer_minutes) setEditErrors(prev => ({ ...prev, gate_timer_minutes: undefined })); }}
                            className={`w-full border ${editErrors.gate_timer_minutes ? "border-red-400" : "border-gray-200"} rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E] mt-1`}
                          />
                          { editErrors.gate_timer_minutes && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.gate_timer_minutes}</p> }
                          <p className="text-[10px] text-gray-400 mt-1 leading-tight">How long the guest has to reach the gate before the car is sent back.</p>
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <input type="checkbox" id="edit_allow_instant_park" checked={editForm.allow_instant_park}
                                 onChange={(e) => setEditForm({ ...editForm, allow_instant_park: e.target.checked })}
                                 className="w-4 h-4 text-[#1A3C6E] bg-gray-100 border-gray-300 rounded focus:ring-[#1A3C6E]" />
                          <label htmlFor="edit_allow_instant_park" className="text-xs font-semibold text-gray-600 uppercase cursor-pointer">
                            Allow Instant Park for this event
                          </label>
                        </div>
                      </div>
                      
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Gates (comma separated)</label>
                        <input
                          type="text"
                          placeholder="e.g., Main Gate, Side Gate"
                          value={editForm.gates}
                          onChange={(e) => { setEditForm({ ...editForm, gates: e.target.value}); if (editErrors.gates) setEditErrors(prev => ({ ...prev, gates: undefined })); }}
                          className={`w-full px-4 py-2 rounded-xl border ${editErrors.gates ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`}
                        />
                        { editErrors.gates && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.gates}</p> }
                      </div>
                      
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Parking Zones</label>
                        {isHotelDaily ? (
                          <div className="space-y-2">
                            {editForm.zones.map((z, i) => (
                              <div key={i} className="flex gap-2 items-center">
                                <div className="flex-1 px-4 py-2 bg-gray-50 rounded-xl border border-gray-100 text-sm font-semibold text-gray-700">{z.name}</div>
                                <div className="w-20 px-4 py-2 bg-gray-50 rounded-xl border border-gray-100 text-sm font-semibold text-gray-700 text-center">{z.slots}</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <>
                            <div className="space-y-2 mb-2">
                              {editForm.zones.map((z, i) => (
                                <div key={i} className="flex gap-2 items-center">
                                  <input ref={el => { if (fieldRefs.current) fieldRefs.current.name = el; }} 
                                    type="text"
                                    placeholder="Zone name (e.g. A)"
                                    value={z.name}
                                    onChange={(e) => {
                                      const zones = [...editForm.zones];
                                      zones[i] = { ...zones[i], name: e.target.value };
                                      setEditForm({ ...editForm, zones });
                                    }}
                                    className="flex-1 px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:border-[#1A3C6E] text-sm"
                                  />
                                  <input
                                    type="number"
                                    placeholder="Slots"
                                    value={z.slots}
                                    min={1}
                                    onChange={(e) => {
                                      const zones = [...editForm.zones];
                                      zones[i] = { ...zones[i], slots: parseInt(e.target.value) || 0 };
                                      setEditForm({ ...editForm, zones });
                                    }}
                                    className="w-20 px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:border-[#1A3C6E] text-sm text-center"
                                  />
                                  <button type="button"
                                    onClick={() => setEditForm({ ...editForm, zones: editForm.zones.filter((_, k) => k !== i) })}
                                    className="text-red-400 hover:text-red-600 font-bold text-lg leading-none px-1">
                                    ×
                                  </button>
                                </div>
                              ))}
                            </div>
                            <button type="button"
                              onClick={() => setEditForm({ ...editForm, zones: [...editForm.zones, { name: "", slots: 10 }] })}
                              className="w-full py-2 rounded-xl border border-dashed border-[#1A3C6E] text-[#1A3C6E] text-sm font-semibold hover:bg-blue-50 transition">
                              + Add Zone
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    
                    {!isHotelDaily && <p className="text-xs text-gray-400 mb-2"><span className="text-red-500">*</span> Required fields</p>}
                    <div className="flex gap-3 pt-2">
                      <button type="button" onClick={() => setEditOpen(false)}
                        className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-semibold hover:bg-gray-50 transition">
                        Cancel
                      </button>
                      <button type="submit"
                        className="flex-1 px-4 py-2.5 rounded-xl bg-[#1A3C6E] text-white font-semibold hover:bg-[#0F2044] transition">
                        Save Changes
                      </button>
                    </div>
                  </form>
                ) : (
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
                )}
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
          </div>
        )}

        {activeTab === "drivers" && (
          <div className="mb-10">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h2 className="font-heading text-lg font-bold text-[#0F2044]">Drivers</h2>
              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input ref={el => { if (fieldRefs.current) fieldRefs.current.name = el; }} 
                  value={driverSearch}
                  onChange={(e) => setDriverSearch(e.target.value)}
                  placeholder="Search by name or employee ID"
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-[#1A3C6E]"
                />
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
              {driversLoading ? (
                <div className="flex justify-center py-10">
                  <div className="animate-spin border-4 border-[#1A3C6E] border-t-transparent rounded-full w-7 h-7" />
                </div>
              ) : drivers.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <p className="text-2xl mb-2">👷</p>
                  <p className="text-sm">No drivers assigned to this event yet.</p>
                </div>
              ) : (
                <div className="overflow-x-auto w-full max-w-full">
                  <table className="w-full text-sm min-w-[600px]">
                    <thead className="bg-gradient-to-r from-gray-50 to-gray-100/50 text-gray-400 uppercase text-[11px] tracking-widest font-bold">
                      <tr>
                        <th className="text-left px-5 py-3.5">Driver</th>
                        <th className="text-left px-5 py-3.5 text-center">Status</th>
                        <th className="text-left px-5 py-3.5 text-center">Cars Checked In</th>
                        <th className="text-left px-5 py-3.5 text-center">Retrievals</th>
                        <th className="text-left px-5 py-3.5 text-center">Incidents</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDrivers.length === 0 && driverSearch && (
                        <tr><td colSpan="5" className="text-center text-gray-400 py-10">No drivers match your search</td></tr>
                      )}
                      {paginatedDrivers.map(driver => (
                        <tr key={driver.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                          <td className="px-5 py-3.5">
                            <div className="font-semibold text-[#1A3C6E]">{driver.name}</div>
                            <div className="text-xs text-gray-400 font-mono">{driver.employee_id}</div>
                          </td>
                          <td className="px-5 py-3.5 text-center">
                            {driver.assigned ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase tracking-wide">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Assigned Here
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 text-[10px] font-bold uppercase tracking-wide">
                                Not Assigned
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3.5 text-center font-semibold">{driver.cars_checked_in ?? 0}</td>
                          <td className="px-5 py-3.5 text-center font-semibold">{driver.cars_retrieved ?? 0}</td>
                          <td className={`px-5 py-3.5 text-center font-bold ${driver.incidents > 0 ? "text-red-500" : "text-emerald-500"}`}>
                            {driver.incidents ?? 0}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredDrivers.length > 10 && (
                    <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between">
                      <span className="text-sm text-gray-400">
                        Showing {Math.min((driversPage - 1) * 10 + 1, filteredDrivers.length)}–{Math.min(driversPage * 10, filteredDrivers.length)} of {filteredDrivers.length}
                      </span>
                      <div className="flex items-center gap-2">
                        <button disabled={driversPage === 1} onClick={() => setDriversPage(p => p - 1)}
                          className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Prev</button>
                        <span className="px-3 py-1.5 rounded-lg bg-[#0F2044] text-white text-sm font-bold">{driversPage}</span>
                        <button disabled={driversPage * 10 >= filteredDrivers.length} onClick={() => setDriversPage(p => p + 1)}
                          className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Next</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "supervisors" && (
          <div className="mb-10">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h2 className="font-heading text-lg font-bold text-[#0F2044]">Supervisors</h2>
              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input ref={el => { if (fieldRefs.current) fieldRefs.current.name = el; }} 
                  value={supervisorSearch}
                  onChange={(e) => setSupervisorSearch(e.target.value)}
                  placeholder="Search by name or email"
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-[#1A3C6E]"
                />
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
              {supsLoading ? (
                <div className="flex justify-center py-10">
                  <div className="animate-spin border-4 border-[#1A3C6E] border-t-transparent rounded-full w-7 h-7" />
                </div>
              ) : supervisors.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <p className="text-2xl mb-2">👷</p>
                  <p className="text-sm">No supervisors assigned to this event yet.</p>
                </div>
              ) : (
                <div className="overflow-x-auto w-full max-w-full">
                  <table className="w-full text-sm min-w-[600px]">
                    <thead className="bg-gradient-to-r from-gray-50 to-gray-100/50 text-gray-400 uppercase text-[11px] tracking-widest font-bold">
                      <tr>
                        <th className="text-left px-5 py-3.5">Name</th>
                        <th className="text-left px-5 py-3.5">Email</th>
                        <th className="text-left px-5 py-3.5">Phone</th>
                        <th className="text-left px-5 py-3.5 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSupervisors.length === 0 && supervisorSearch && (
                        <tr><td colSpan="4" className="text-center text-gray-400 py-10">No supervisors match your search</td></tr>
                      )}
                      {paginatedSupervisors.map(s => (
                        <tr key={s.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                          <td className="px-5 py-3.5 font-semibold text-[#1A3C6E]">{s.name}</td>
                          <td className="px-5 py-3.5 text-gray-500">{s.email}</td>
                          <td className="px-5 py-3.5 text-gray-500">{s.phone || "—"}</td>
                          <td className="px-5 py-3.5 text-center">
                            {s.assigned ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase tracking-wide">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Assigned Here
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 text-[10px] font-bold uppercase tracking-wide">
                                Not Assigned
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredSupervisors.length > 10 && (
                    <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between">
                      <span className="text-sm text-gray-400">
                        Showing {Math.min((supervisorsPage - 1) * 10 + 1, filteredSupervisors.length)}–{Math.min(supervisorsPage * 10, filteredSupervisors.length)} of {filteredSupervisors.length}
                      </span>
                      <div className="flex items-center gap-2">
                        <button disabled={supervisorsPage === 1} onClick={() => setSupervisorsPage(p => p - 1)}
                          className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Prev</button>
                        <span className="px-3 py-1.5 rounded-lg bg-[#0F2044] text-white text-sm font-bold">{supervisorsPage}</span>
                        <button disabled={supervisorsPage * 10 >= filteredSupervisors.length} onClick={() => setSupervisorsPage(p => p + 1)}
                          className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Next</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "cars" && (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="font-heading text-xl font-bold text-[#0F2044]">Car Activity Log</h2>
              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={carSearch}
                  onChange={(e) => setCarSearch(e.target.value)}
                  placeholder="Search plate, make, color, driver…"
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-[#1A3C6E]"
                />
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden">
              {carsLoading ? (
                <div className="flex justify-center py-10">
                  <div className="animate-spin border-4 border-[#1A3C6E] border-t-transparent rounded-full w-7 h-7" />
                </div>
              ) : (
                <div className="overflow-x-auto w-full max-w-full">
                  <table className="w-full text-sm min-w-[600px]">
                    <thead className="bg-gray-50 text-gray-500 uppercase text-xs font-semibold">
                      <tr>
                        <th className="text-left px-5 py-3">Plate</th>
                        <th className="text-left px-5 py-3">Make/Color</th>
                        <th className="text-left px-5 py-3">Gate</th>
                        <th className="text-left px-5 py-3">Zone/Slot</th>
                        <th className="text-left px-5 py-3">Status</th>
                        <th className="text-left px-5 py-3">Check-in Driver</th>
                        <th className="text-left px-5 py-3">Retrieved By</th>
                        <th className="text-left px-5 py-3">Entry Time</th>
                        <th className="text-left px-5 py-3">Exit Time</th>
                        <th className="text-right px-5 py-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCars.map(c => (
                        <tr key={c.id}>
                          <td colSpan={10} className="p-0">
                            <div
                              onClick={() => nav(`/provider/cars/${encodeURIComponent(c.plate)}`)}
                              className="w-full border-t border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors flex items-center"
                            >
                              <div className="flex-1 grid grid-cols-9">
                                <div className="px-5 py-3 font-bold uppercase flex items-center gap-2 col-span-1">
                                  {c.plate}
                                  {c.carried_forward && (
                                    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                                      Overnight
                                    </span>
                                  )}
                                </div>
                                <div className="px-5 py-3 text-gray-600 col-span-1">{c.make} / {c.color}</div>
                                <div className="px-5 py-3 text-gray-500 col-span-1">{c.gate || "—"}</div>
                                <div className="px-5 py-3 font-medium col-span-1">{c.zone ? `${c.zone} / ${c.slot}` : "—"}</div>
                                <div className="px-5 py-3 col-span-1">
                                  <StatusBadge status={c.status} />
                                </div>
                                <div className="px-5 py-3 text-gray-600 col-span-1">{c.check_in_driver_name}</div>
                                <div className="px-5 py-3 text-gray-600 col-span-1">{c.retrieval_driver_name}</div>
                                <div className="px-5 py-3 text-gray-400 font-mono text-[11px] col-span-1">
                                  {c.check_in_time ? fmtTime(c.check_in_time) : "—"}
                                </div>
                                <div className="px-5 py-3 text-gray-400 font-mono text-[11px] col-span-1">
                                  {c.delivered_at ? fmtTime(c.delivered_at) : "—"}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {filteredCars.length === 0 && <tr><td colSpan="10" className="p-8 text-center text-gray-400">{carSearch ? "No cars match your search" : "No car activity recorded"}</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "incidents" && (
          <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-gray-100">
              <h2 className="font-heading text-lg font-bold text-[#0F2044]">Incidents
                <span className="ml-2 text-sm font-normal text-gray-400">({filteredIncidents.length} total)</span>
              </h2>
              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={incidentSearch} onChange={e => { setIncidentSearch(e.target.value); setIncidentsPage(1); }}
                  placeholder="Search incidents…"
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-[#1A3C6E]" />
              </div>
            </div>
            
            {incidentsLoading ? (
              <div className="flex justify-center py-10">
                <div className="animate-spin border-4 border-[#1A3C6E] border-t-transparent rounded-full w-7 h-7" />
              </div>
            ) : (
              <div className="overflow-x-auto w-full max-w-full">
                <table className="w-full text-sm min-w-[600px]">
                  <thead className="bg-gray-50 text-gray-500 uppercase text-xs tracking-wider">
                    <tr>
                      <th className="text-left px-6 py-3">Description</th>
                      <th className="text-left px-6 py-3">Type</th>
                      <th className="text-left px-6 py-3">Car</th>
                      <th className="text-left px-6 py-3">Reported By</th>
                      <th className="text-left px-6 py-3">Date</th>
                      <th className="text-left px-6 py-3">Status</th>
                      <th className="text-left px-6 py-3">Remark</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedIncidents.length === 0 && (
                      <tr><td colSpan="7" className="text-center text-gray-400 py-12">No incidents found</td></tr>
                    )}
                    {paginatedIncidents.map((inc, i) => (
                      <tr key={inc.id || i} className="border-t border-gray-100 hover:bg-[#F4F6FA] transition-colors">
                        <td className="px-6 py-4 text-gray-600 max-w-xs truncate">{inc.description || "—"}</td>
                        <td className="px-6 py-4">
                          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-gray-100 text-gray-700">
                            {(inc.incident_type || "UNKNOWN").replace(/_/g, " ").replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.substr(1).toLowerCase())}
                          </span>
                        </td>
                        <td className="px-6 py-4 font-mono text-gray-500">{inc.plate || "—"}</td>
                        <td className="px-6 py-4 text-gray-500">{inc.reported_by || "—"}</td>
                        <td className="px-6 py-4 text-gray-500 text-xs">{fmtDate(inc.created_at)}</td>
                        <td className="px-6 py-4">
                          {inc.status ? (
                            <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                              inc.status === "OPEN" ? "bg-red-100 text-red-700" :
                              inc.status === "IN_REVIEW" ? "bg-amber-100 text-amber-700" :
                              inc.status === "RESOLVED" ? "bg-emerald-100 text-emerald-700" :
                              "bg-gray-100 text-gray-600"
                            }`}>
                              {inc.status}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-6 py-4 text-gray-500 max-w-xs truncate" title={inc.remark || ""}>
                          {inc.remark || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!incidentsLoading && filteredIncidents.length > 10 && (
              <div className="px-4 sm:px-6 py-4 border-t border-gray-100 flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-gray-400">Showing {Math.min((incidentsPage-1)*10+1, filteredIncidents.length)}–{Math.min(incidentsPage*10, filteredIncidents.length)} of {filteredIncidents.length}</span>
                <div className="flex flex-wrap items-center gap-2">
                  <button disabled={incidentsPage === 1} onClick={() => setIncidentsPage(p => p-1)} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Prev</button>
                  <span className="px-3 py-1.5 rounded-lg bg-[#0F2044] text-white text-sm font-bold">{incidentsPage}</span>
                  <button disabled={incidentsPage * 10 >= filteredIncidents.length} onClick={() => setIncidentsPage(p => p+1)} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Next</button>
                </div>
              </div>
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

                    {item.issues && (
                      <div className="flex flex-col gap-1.5 mb-3">
                        {FEEDBACK_QUESTIONS.map(q => {
                          const answer = item.issues[q.key];
                          if (answer === undefined) return null;
                          return (
                            <div key={q.key} className="flex items-center justify-between gap-2 bg-gray-50 px-3 py-2 rounded-lg border border-gray-100">
                              <span className="text-xs text-gray-600">{q.label}</span>
                              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold shrink-0 ${answer ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-emerald-50 text-emerald-600 border border-emerald-100'}`}>
                                {answer ? 'Yes' : 'No'}
                              </span>
                            </div>
                          );
                        })}
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

      {qrModalCar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in" onClick={() => setQrModalCar(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-6 text-center border-b border-gray-100">
              <h3 className="font-heading text-xl font-bold text-[#0F2044] uppercase">{qrModalCar.plate}</h3>
              <p className="text-gray-500 text-sm">{qrModalCar.guest_name || "Guest"}</p>
            </div>
            <div className="p-8 flex flex-col items-center">
              {qrModalCar.retrieval_token ? (
                <>
                  <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                    <QRCodeSVG id="guest-qr-svg" value={`${window.location.origin}/r/${qrModalCar.retrieval_token}`} size={200} />
                  </div>
                  {qrModalCar.checkin_code && (
                    <div className="mt-6 font-mono text-3xl font-bold text-gray-700 tracking-[0.2em]">
                      {qrModalCar.checkin_code}
                    </div>
                  )}
                  <p className="text-xs text-gray-400 mt-2">Scan to retrieve or present code</p>
                </>
              ) : (
                <p className="text-gray-500 text-center py-8">QR not available for this check-in</p>
              )}
            </div>
            <div className="p-4 bg-gray-50 flex gap-3">
              <button onClick={() => setQrModalCar(null)} className="flex-1 py-2.5 rounded-xl font-bold text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 transition-colors">
                Close
              </button>
              {qrModalCar.retrieval_token && (
                <button onClick={downloadQrSvg} className="flex-1 py-2.5 rounded-xl font-bold text-white bg-[#1A3C6E] hover:bg-[#0F2044] transition-colors flex items-center justify-center gap-2">
                  <Download className="w-4 h-4" /> Download
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </OwnerLayout>

  );
}

