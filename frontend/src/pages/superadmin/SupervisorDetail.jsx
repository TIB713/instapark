import { useEffect, useState, useMemo , useRef} from 'react';
import { Link, useParams, useNavigate } from "react-router-dom";
import SuperLayout from "@/components/layout/SuperLayout";
import { api, decodeJwt } from "@/lib/api";
import { fmtDateTimeFull, fmtDate } from "@/lib/time";
import { toast } from "sonner";
import { ArrowLeft, User, Phone, Shield, Calendar, Mail, Building2, Clock, CheckCircle2, Check, Download, Edit2, Save, X, Camera, Search, AlertTriangle, CreditCard, Landmark, ChevronDown, Trash2, Star } from "lucide-react";
import EmptyState from "@/components/ui/EmptyState";

export default function SupervisorDetail() {
  const { sid } = useParams();
  const nav = useNavigate();
  const [supervisor, setSupervisor] = useState(null);
  const [stats, setStats] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [eventSearch, setEventSearch] = useState("");
  const [eventStatusFilter, setEventStatusFilter] = useState("all");
  const [eventDateFilter, setEventDateFilter] = useState("");
  const [openDropdown, setOpenDropdown] = useState(null);

  const [supervisorIncidents, setSupervisorIncidents] = useState([]);
  const [loadingIncidents, setLoadingIncidents] = useState(false);
  const [incidentSearch, setIncidentSearch] = useState("");
  const [incidentsPage, setIncidentsPage] = useState(1);
  const [eventsPage, setEventsPage] = useState(1);
  const [activeTab, setActiveTab] = useState("info");
  const [lightbox, setLightbox] = useState(null);

  useEffect(() => { setEventsPage(1); }, [eventSearch, eventStatusFilter, eventDateFilter]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e) => { if (e.key === "Escape") setLightbox(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [editErrors, setEditErrors] = useState({});
  const [uploading, setUploading] = useState(false);

  const token = localStorage.getItem("superadmin_token");
  const userObj = token ? decodeJwt(token) : null;
  const isSuperadmin = userObj?.role === "superadmin";


  useEffect(() => {
    if (activeTab === "incidents" && supervisorIncidents.length === 0) {
      setLoadingIncidents(true);
      api.get(`/incidents/supervisor/${sid}`)
        .then(r => setSupervisorIncidents(r.data))
        .catch(() => toast.error("Failed to load incidents"))
        .finally(() => setLoadingIncidents(false));
    }
  }, [activeTab, supervisorIncidents.length, sid]);
  useEffect(() => {
    if (!editOpen) return;
    const handleEsc = (e) => {
      if (e.key === "Escape") {
        setEditOpen(false); setEditErrors({});
      }
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [editOpen]);

  const handleDelete = async () => {
    if (!window.confirm("WARNING: This will permanently delete this supervisor and cannot be undone. Are you sure?")) return;
    try {
      await api.delete(`/superadmin/supervisors/${sid}/permanent`);
      toast.success("Supervisor permanently deleted");
      nav("/superadmin/supervisors");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to delete supervisor");
    }
  };

  const loadInitial = async () => {
    try {
      const [resSup, resStats, resEvents] = await Promise.all([
        api.get(`/supervisors/${sid}`),
        api.get(`/supervisors/${sid}/stats`),
        api.get(`/supervisors/${sid}/events`)
      ]);
      setSupervisor(resSup.data);
      setStats(resStats.data);
      setEvents(resEvents.data);
    } catch (err) {
      toast.error("Failed to load supervisor details");
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadInitial(); }, [sid]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest('.filter-dropdown-container')) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const generateSupervisorPDF = async () => {
    try {
      const { data } = await api.get(`/supervisors/${sid}/report`);
      const s = data.supervisor;
      const sum = data.summary;

      const eventRows = data.events.map(e => `
        <tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:10px;font-weight:700;">${e.event_name}</td>
          <td style="padding:10px;">${e.event_date || "—"}</td>
          <td style="padding:10px;">${e.venue || "—"}</td>
          <td style="padding:10px;text-align:center;">
            <span style="background:${e.status === 'active' ? '#D1FAE5' : '#F3F4F6'};
                         color:${e.status === 'active' ? '#065F46' : '#6B7280'};
                         padding:2px 8px;border-radius:99px;font-size:11px;">
              ${e.status}
            </span>
          </td>
          <td style="padding:10px;text-align:center;">${e.total_cars}</td>
          <td style="padding:10px;text-align:center;">${e.platform_avg_rating > 0 ? e.platform_avg_rating + "★" : "—"} (P) / ${e.driver_avg_rating > 0 ? e.driver_avg_rating + "★" : "—"} (D)</td>
          <td style="padding:10px;text-align:center;">${e.drivers_count}</td>
        </tr>
      `).join("");

      const html = `<!DOCTYPE html><html><head>
        <meta charset="UTF-8">
        <style>
          *{margin:0;padding:0;box-sizing:border-box;}
          body{font-family:Arial,sans-serif;color:#111827;font-size:13px;}
          .header{background:#0F2044;color:white;padding:32px 40px;overflow:hidden;}
          .header-photo{float:right;width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,0.3);}
          .header h1{font-size:24px;font-weight:900;}
          .header p{opacity:0.7;margin-top:4px;font-size:13px;}
          .section{padding:28px 40px;border-bottom:1px solid #f3f4f6;}
          .section h2{font-size:11px;font-weight:800;color:#0F2044;letter-spacing:3px;margin-bottom:16px;text-transform:uppercase;}
          .stats-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:16px;}
          .stat-card{background:#f9fafb;border-radius:12px;padding:16px;text-align:center;}
          .stat-value{font-size:24px;font-weight:900;color:#111827;}
          .stat-label{font-size:10px;color:#6b7280;margin-top:4px;text-transform:uppercase;letter-spacing:1px;}
          table{width:100%;border-collapse:collapse;font-size:12px;}
          th{padding:10px;text-align:left;background:#f9fafb;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;font-weight:700;border-bottom:1px solid #e5e7eb;}
          .footer{padding:20px 40px;text-align:center;color:#9ca3af;font-size:11px;}
        </style></head><body>
        <div class="header">
          ${s.supervisor_photo ? `<img src="${s.supervisor_photo}" class="header-photo" />` : ""}
          <h1>${s.name}</h1>
          <p>${s.email} · ${s.phone || "No phone"}</p>
          <p>Provider: ${s.provider_name || "—"}</p>
          <p style="margin-top:8px;font-size:11px;opacity:0.5;">Generated on ${fmtDateTimeFull(new Date().toISOString())}</p>
        </div>
        <div class="section">
          <h2>SUPERVISION SUMMARY</h2>
          <div class="stats-grid">
            <div class="stat-card"><div class="stat-value">${sum.total_events}</div><div class="stat-label">Total Events</div></div>
            <div class="stat-card"><div class="stat-value">${sum.incidents_reported ?? 0}</div><div class="stat-label">Incidents Reported</div></div>
            <div class="stat-card"><div class="stat-value">${sum.platform_avg_rating > 0 ? sum.platform_avg_rating + "★" : "—"}</div><div class="stat-label">Platform Rating</div></div>
            <div class="stat-card"><div class="stat-value">${sum.driver_avg_rating > 0 ? sum.driver_avg_rating + "★" : "—"}</div><div class="stat-label">Driver Rating</div></div>
            <div class="stat-card"><div class="stat-value">${sum.total_drivers_overseen}</div><div class="stat-label">Unique Drivers Overseen</div></div>
          </div>
        </div>
        <div class="section">
          <h2>MANAGED EVENTS</h2>
          <table><thead><tr><th>Event</th><th>Date</th><th>Venue</th><th>Status</th><th>Cars</th><th>Rating</th><th>Drivers</th></tr></thead>
          <tbody>${eventRows}</tbody></table>
        </div>
        <div class="footer">InstaPark — Smart Valet Operations · Supervisor Report for ${s.name}</div>
      </body></html>`;

      const w = window.open("", "_blank");
      w.document.write(html);
      w.document.close();
      setTimeout(() => w.print(), 500);
      toast.success("Supervisor report ready to print/save");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to generate report");
    }
  };

  const toggleActive = async () => {
    const action = supervisor.is_active ? "deactivate" : "reactivate";
    if (!window.confirm(`Are you sure you want to ${action} this supervisor?`)) return;
    try {
      await api.patch(`/supervisors/${sid}`, { is_active: !supervisor.is_active });
      setSupervisor({ ...supervisor, is_active: !supervisor.is_active });
      toast.success(`Supervisor ${action}d successfully`);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to update status");
    }
  };

    const validateEdit = () => {
    const errs = {};
    if (!editForm.name?.trim()) errs.name = "Name cannot be empty";
    if (!editForm.email?.trim()) errs.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editForm.email.trim())) errs.email = "Please enter a valid email address";
    if (!editForm.gender) errs.gender = "Please select gender";
    if (!editForm.phone?.trim()) errs.phone = "Phone is required";
    else if (!/^\d{10}$/.test(editForm.phone.replace(/\D/g, ""))) errs.phone = "Phone must be exactly 10 digits";
    if (editForm.pan_number && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(editForm.pan_number.trim().toUpperCase())) errs.pan_number = "Invalid PAN format. Expected: ABCDE1234F";
    if (editForm.bank_account_number && !/^\d{9,18}$/.test(editForm.bank_account_number.trim())) errs.bank_account_number = "Bank account number must be 9-18 digits";
    if (editForm.bank_ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(editForm.bank_ifsc.trim().toUpperCase())) errs.bank_ifsc = "Invalid IFSC format. Expected: ABCD0123456";
    if (!editForm.aadhar_number?.trim()) errs.aadhar_number = "Aadhar Number is required";
    else if (!/^\d{12}$/.test(editForm.aadhar_number.trim())) errs.aadhar_number = "Aadhar number must be exactly 12 digits";
    if (!supervisor.aadhar_photo) errs.aadhar_photo = "Aadhar Photo is required";
    if (editForm.password) {
      if (editForm.password.length < 8) errs.password = "Password must be at least 8 characters";
      else if (editForm.password !== editForm.confirmPassword) errs.confirmPassword = "Passwords do not match";
    }
    return errs;
  };

  const handleSaveSupervisor = async (e) => {
    e.preventDefault();
    const errs = validateEdit();
    setEditErrors(errs);
    if (Object.keys(errs).length > 0) return;
    try {
      const payload = { ...editForm };
      if (!payload.password) delete payload.password;
      delete payload.confirmPassword;
      await api.patch(`/supervisors/${sid}`, payload);
      toast.success("Supervisor updated successfully");
      setEditOpen(false); setEditErrors({});
      loadInitial();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to update supervisor");
    }
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "supervisors");
      const { data } = await api.post("/upload", fd);
      await api.patch(`/supervisors/${sid}`, { supervisor_photo: data.url });
      setSupervisor({ ...supervisor, supervisor_photo: data.url });
      toast.success("Photo updated");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Photo upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleAadharPhotoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "aadhar_photos");
      const { data } = await api.post("/upload", fd);
      await api.patch(`/supervisors/${sid}`, { aadhar_photo: data.url });
      setSupervisor(prev => ({ ...prev, aadhar_photo: data.url }));
      if (editErrors.aadhar_photo) setEditErrors(prev => ({ ...prev, aadhar_photo: undefined }));
      toast.success("Aadhar photo updated");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Aadhar photo upload failed");
    } finally {
      setUploading(false);
    }
  };

  const initials = supervisor?.name
    ? supervisor.name.split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase()
    : "";


  const filteredSupervisorIncidents = useMemo(() =>
    supervisorIncidents.filter(i =>
      !incidentSearch ||
      i.description?.toLowerCase().includes(incidentSearch.toLowerCase())
    ), [supervisorIncidents, incidentSearch]);
  const paginatedSupervisorIncidents = filteredSupervisorIncidents.slice((incidentsPage-1)*10, incidentsPage*10);
  const filteredEvents = useMemo(() => 
    events.filter(e => {
      const matchQ = !eventSearch || `${e.name} ${e.venue}`.toLowerCase().includes(eventSearch.toLowerCase());
      const matchStatus = eventStatusFilter === "all" || e.status === eventStatusFilter;
      const matchDate = !eventDateFilter || e.date === eventDateFilter;
      return matchQ && matchStatus && matchDate;
    }), [events, eventSearch, eventStatusFilter, eventDateFilter]);

  const paginatedEvents = filteredEvents.slice((eventsPage - 1) * 10, eventsPage * 10);

  if (loading) return (
    <SuperLayout title="Supervisor Detail">
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="w-10 h-10 rounded-full border-4 border-[#1A3C6E] border-t-transparent animate-spin" />
        <p className="text-gray-400 text-sm font-medium">Loading...</p>
      </div>
    </SuperLayout>
  );
  if (!supervisor) return <SuperLayout title="Supervisor Detail"><div className="p-8 text-center text-gray-400">Supervisor not found</div></SuperLayout>;

  return (
    <SuperLayout title="Supervisor Detail">
      <Link to="/superadmin/supervisors"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#1A3C6E] hover:text-[#0F2044] mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Supervisors
      </Link>
      
      <div className="bg-[#0F2044] rounded-2xl overflow-hidden shadow-card">
        <div className="px-4 sm:px-8 pt-4 sm:pt-8 pb-4 sm:pb-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            {/* LEFT */}
            <div className="flex items-start gap-4 min-w-0">
              <div className="relative group shrink-0">
                {supervisor.supervisor_photo ? (
                  <img src={supervisor.supervisor_photo} alt={supervisor.name} className="w-16 h-16 rounded-2xl object-cover border-2 border-white/20 shadow-lg" />
                ) : (
                  <span className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center text-lg font-bold text-white shadow-lg shrink-0">{initials}</span>
                )}
                <label className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-2xl opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity z-10">
                  <Camera className="w-5 h-5 text-white" />
                  <input type="file" className="hidden" accept="image/*" onChange={handlePhotoUpload} disabled={uploading} />
                </label>
                {supervisor.supervisor_photo && (
                  <button type="button" onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      await api.patch(`/supervisors/${sid}`, { supervisor_photo: null });
                      setSupervisor(prev => ({ ...prev, supervisor_photo: null }));
                      toast.success("Photo removed");
                    } catch (err) { toast.error(err.response?.data?.detail || "Failed to remove photo"); }
                  }} className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-400 hover:text-red-500 hover:border-red-200 transition-all z-20">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h1 className="font-heading text-2xl font-bold text-white truncate">{supervisor.name}</h1>
                  {supervisor?.is_verified ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
                      <Check className="w-3 h-3" /> Verified
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium">
                      <AlertTriangle className="w-3 h-3" /> Unverified
                    </span>
                  )}
                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${(supervisor?.is_verified && supervisor?.is_active) ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/30" : "bg-red-500/20 text-red-300 border border-red-400/30"}`}>
                    {(supervisor?.is_verified && supervisor?.is_active) ? "Active" : "Inactive"}
                  </span>
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-white/10 text-white/90 border border-white/20 truncate">
                    {supervisor.provider_name || "—"}
                  </span>
                </div>
                <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mt-0.5">Supervisor Profile</p>
                
                <div className="mt-4 pt-4 border-t border-white/10 grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {[
                    { label: "Total Events", value: stats?.total_events ?? 0, icon: Calendar, tab: "events" },
                    { label: "Incidents", value: stats?.incidents_reported ?? 0, icon: AlertTriangle, tab: "incidents" },
                    { label: "Platform Rating", value: stats?.platform_avg_rating > 0 ? stats?.platform_avg_rating + "★" : "—", icon: Star, tab: null },
                    { label: "Driver Rating", value: stats?.driver_avg_rating > 0 ? stats?.driver_avg_rating + "★" : "—", icon: Star, tab: null },
                    { label: "Drivers Overseen", value: stats?.total_drivers_overseen ?? 0, icon: User, tab: null }
                  ].map(s => (
                    <div
                      key={s.label}
                      onClick={() => s.tab && setActiveTab(s.tab)}
                      className={`bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 flex flex-col items-center gap-1 transition-all duration-150 ${s.tab
                        ? "cursor-pointer hover:bg-white/15 hover:border-amber-400/40 hover:scale-[1.03]"
                        : "cursor-default"
                        } ${s.tab && activeTab === s.tab
                          ? "bg-white/15 border-amber-400/50 ring-1 ring-amber-400/30"
                          : ""
                        }`}
                    >
                      <div className="flex items-center gap-1 text-amber-400">
                        <s.icon className="w-3 h-3" />
                        <div className="text-[8px] uppercase font-bold text-white/40 tracking-wider">{s.label}</div>
                      </div>
                      <div className="text-lg font-black text-white">{s.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* RIGHT */}
            <div className="flex items-start gap-4 flex-wrap shrink-0">
              <button
                onClick={generateSupervisorPDF}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/30 text-white bg-white/10 hover:bg-white/20 transition text-sm font-semibold"
              >
                <Download className="w-4 h-4" /> Download Report
              </button>
              <button
                onClick={toggleActive}
                className={`px-4 py-2 text-sm rounded-xl font-semibold transition border ${(supervisor?.is_verified && supervisor?.is_active)
                  ? "border-red-400 bg-red-500/20 text-red-100 hover:bg-red-500/40"
                  : "border-emerald-300 bg-emerald-500 text-white hover:bg-emerald-600"
                  }`}
              >
                {(supervisor?.is_verified && supervisor?.is_active) ? "Inactive" : "Active"}
              </button>
              {isSuperadmin && (
                <button
                  onClick={handleDelete}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/20 text-red-100 hover:bg-red-500/40 transition text-sm font-semibold border border-red-400/30"
                >
                  <Trash2 className="w-4 h-4" /> Delete
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex bg-black/20 border-t-2 border-amber-400/20 overflow-x-auto">
          {[
            { id: "info", label: "Info", icon: User },
            { id: "events", label: "Events", icon: Calendar },
            { id: "incidents", label: "Incidents", icon: AlertTriangle }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3 sm:px-6 py-3 sm:py-3.5 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap border-b-[3px] ${
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
          <div className="grid grid-cols-1 gap-6">

            <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <h3 className="font-heading text-lg font-bold text-[#0F2044]">Supervisor Information</h3>
                {!editOpen && (
                  <button onClick={() => {
                    setEditOpen(true);
                    setEditForm({
                      name: supervisor.name || "",
                      phone: supervisor.phone || "",
                      email: supervisor.email || "",
                      gender: supervisor.gender || "",
                      pan_number: supervisor.pan_number || "",
                      bank_account_number: supervisor.bank_account_number || "",
                      bank_ifsc: supervisor.bank_ifsc || "",
                      aadhar_number: supervisor.aadhar_number || "",
                      aadhar_photo: supervisor.aadhar_photo || "",
                      password: "",
                      confirmPassword: ""
                    });
                  }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1D4ED8] text-white text-xs font-bold hover:bg-[#1E40AF] transition-all">
                    <Edit2 className="w-3.5 h-3.5" /> Edit
                  </button>
                )}
              </div>
{!editOpen ? (
          <>
            <div className="space-y-6 pt-6 border-t border-gray-50"> 
              <div className="flex items-center gap-3"> 
                <div className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center text-gray-400"><Mail className="w-5 h-5" /></div> 
                <div> 
                  <div className="text-[10px] uppercase font-bold text-gray-400">Email</div> 
                  <div className="text-sm font-semibold">{supervisor.email}</div> 
                </div> 
              </div> 
              <div className="flex items-center gap-3"> 
                <div className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center text-gray-400"><Phone className="w-5 h-5" /></div> 
                <div> 
                  <div className="text-[10px] uppercase font-bold text-gray-400">Phone</div> 
                  <div className="text-sm font-semibold">{supervisor.phone || "—"}</div> 
                </div> 
              </div> 
              <div className="flex items-center gap-3"> 
                <div className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center text-gray-400"><Building2 className="w-5 h-5" /></div> 
                <div> 
                  <div className="text-[10px] uppercase font-bold text-gray-400">Provider</div> 
                  <div className="text-sm font-semibold">{supervisor.provider_name || "—"}</div> 
                </div> 
              </div> 
              {supervisor.gender && (
                <div className="flex items-center gap-3"> 
                  <div className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center text-gray-400"><User className="w-5 h-5" /></div> 
                  <div> 
                    <div className="text-[10px] uppercase font-bold text-gray-400">Gender</div> 
                    <div className="text-sm font-semibold capitalize">{supervisor.gender}</div> 
                  </div> 
                </div> 
              )}
              {supervisor.pan_number && (
                <div className="flex items-center gap-3"> 
                  <div className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center text-gray-400"><CreditCard className="w-5 h-5" /></div> 
                  <div> 
                    <div className="text-[10px] uppercase font-bold text-gray-400">PAN Number</div> 
                    <div className="font-mono text-sm font-semibold tracking-widest">{supervisor.pan_number}</div> 
                  </div> 
                </div>
              )}
              {supervisor.bank_account_number && (
                <div className="flex items-start gap-3"> 
                  <div className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center text-gray-400 mt-0.5"><Landmark className="w-5 h-5" /></div> 
                  <div> 
                    <div className="text-[10px] uppercase font-bold text-gray-400 mb-1">Bank Account</div> 
                    <div className="font-mono text-sm text-gray-700">{supervisor.bank_account_number}</div> 
                    <div className="font-mono text-xs text-gray-400 mt-0.5">{supervisor.bank_ifsc || "—"}</div> 
                  </div> 
                </div> 
              )}
              {supervisor.aadhar_number && (
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center text-gray-400"><CreditCard className="w-5 h-5" /></div>
                  <div>
                    <div className="text-[10px] uppercase font-bold text-gray-400">Aadhar Number</div>
                    <div className="font-mono text-sm font-semibold tracking-widest">{supervisor.aadhar_number}</div>
                  </div>
                </div>
              )}
              {supervisor.aadhar_photo && (
                <div> 
                  <div className="text-[10px] uppercase font-bold text-gray-400 mb-2">Aadhar Photo</div> 
                  <div className="relative inline-block w-full">
                    <img src={supervisor.aadhar_photo} alt="Aadhar" className="h-32 w-full object-cover rounded-xl border border-gray-200 cursor-pointer hover:opacity-90 transition" onClick={() => setLightbox(supervisor.aadhar_photo)} /> 
                  </div>
                </div>
              )}
            </div> 

          </>
        ) : (
          <form onSubmit={handleSaveSupervisor} className="pt-6 border-t border-gray-50 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Name</label>
                <input value={editForm.name} onChange={e => { setEditForm({...editForm, name: e.target.value}); if (editErrors.name) setEditErrors(prev => ({ ...prev, name: undefined })); }} className={`w-full px-4 py-2 rounded-xl border ${editErrors.name ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`} />
{ editErrors.name && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.name}</p> }
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Phone</label>
                <input value={editForm.phone} onChange={e => { setEditForm({...editForm, phone: e.target.value}); if (editErrors.phone) setEditErrors(prev => ({ ...prev, phone: undefined })); }} className={`w-full px-4 py-2 rounded-xl border ${editErrors.phone ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`} />
{ editErrors.phone && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.phone}</p> }
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Email <span className="text-red-500">*</span></label>
                <input value={editForm.email || ""} onChange={e => { setEditForm({...editForm, email: e.target.value}); if (editErrors.email) setEditErrors(prev => ({ ...prev, email: undefined })); }}
                  className={`w-full px-4 py-2 rounded-xl border ${editErrors.email ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`} />
                {editErrors.email && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.email}</p>}
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Gender <span className="text-red-500">*</span></label>
                <select value={editForm.gender}
                  onChange={e => { setEditForm({ ...editForm, gender: e.target.value}); if (editErrors.gender) setEditErrors(prev => ({ ...prev, gender: undefined })); }}
                  className={`w-full px-4 py-2 rounded-xl border ${editErrors.gender ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`}>
                  <option value="" disabled>Select gender</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
{ editErrors.gender && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.gender}</p> }
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">PAN Number</label>
                <input value={editForm.pan_number} onChange={e => { setEditForm({...editForm, pan_number: e.target.value.toUpperCase().slice(0, 10)}); if (editErrors.pan_number) setEditErrors(prev => ({ ...prev, pan_number: undefined })); }} className={`w-full font-mono px-4 py-2 rounded-xl border ${editErrors.pan_number ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`} />
{ editErrors.pan_number && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.pan_number}</p> }
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Bank Account</label>
                <input value={editForm.bank_account_number} onChange={e => { setEditForm({...editForm, bank_account_number: e.target.value.replace(/\D/g, "").slice(0, 18)}); if (editErrors.bank_account_number) setEditErrors(prev => ({ ...prev, bank_account_number: undefined })); }} className={`w-full font-mono px-4 py-2 rounded-xl border ${editErrors.bank_account_number ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`} />
{ editErrors.bank_account_number && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.bank_account_number}</p> }
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Bank IFSC</label>
                <input value={editForm.bank_ifsc} onChange={e => { setEditForm({...editForm, bank_ifsc: e.target.value.toUpperCase().slice(0, 11)}); if (editErrors.bank_ifsc) setEditErrors(prev => ({ ...prev, bank_ifsc: undefined })); }} className={`w-full font-mono px-4 py-2 rounded-xl border ${editErrors.bank_ifsc ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`} />
{ editErrors.bank_ifsc && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.bank_ifsc}</p> }
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Aadhar Number <span className="text-red-500">*</span></label>
                <input value={editForm.aadhar_number || ""} inputMode="numeric"
                  onChange={e => { setEditForm({...editForm, aadhar_number: e.target.value.replace(/\D/g, "").slice(0, 12)}); if (editErrors.aadhar_number) setEditErrors(prev => ({ ...prev, aadhar_number: undefined })); }}
                  className={`w-full font-mono px-4 py-2 rounded-xl border ${editErrors.aadhar_number ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`} />
                {editErrors.aadhar_number && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.aadhar_number}</p>}
              </div>
              <div> 
                <div className="text-[10px] uppercase font-bold text-gray-400 mb-2">Aadhar Photo</div> 
                <div className="relative group inline-block w-full">
                  {supervisor.aadhar_photo ? (
                    <>
                      <img src={supervisor.aadhar_photo} alt="Aadhar" className={`h-32 w-full object-cover rounded-xl border ${editErrors.aadhar_photo ? "border-red-400" : "border-gray-200"} cursor-pointer hover:opacity-90 transition`} onClick={() => setLightbox(supervisor.aadhar_photo)} /> 
                      <label className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-xl opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity">
                        <Camera className="w-5 h-5 text-white" />
                        <input type="file" className="hidden" accept="image/*" onChange={handleAadharPhotoUpload} disabled={uploading} />
                      </label>
                      <button type="button" onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          await api.patch(`/supervisors/${sid}`, { aadhar_photo: null });
                          setSupervisor(prev => ({ ...prev, aadhar_photo: null }));
                          if (editErrors.aadhar_photo) setEditErrors(prev => ({ ...prev, aadhar_photo: undefined }));
                          toast.success("Aadhar photo removed");
                        } catch (err) { toast.error(err.response?.data?.detail || "Failed to remove Aadhar photo"); }
                      }} className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-400 hover:text-red-500 hover:border-red-200 transition-all z-10">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <label className={`flex flex-col items-center justify-center h-32 w-full bg-gray-50 border-2 border-dashed ${editErrors.aadhar_photo ? "border-red-400 bg-red-50" : "border-gray-200"} rounded-xl cursor-pointer hover:bg-gray-100 hover:border-gray-300 transition-all`}>
                      <Camera className="w-6 h-6 text-gray-400 mb-2" />
                      <span className="text-xs text-gray-500 font-semibold">Upload Aadhar</span>
                      <input type="file" className="hidden" accept="image/*" onChange={handleAadharPhotoUpload} disabled={uploading} />
                    </label>
                  )}
                </div> 
                {editErrors.aadhar_photo && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.aadhar_photo}</p>} 
              </div>
              {isSuperadmin && (
                <>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">New Password (leave blank to keep current)</label>
                    <input type="password" value={editForm.password || ""} name="new-supervisor-password" autoComplete="new-password" onChange={e => setEditForm({...editForm, password: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Confirm Password</label>
                    <input type="password" value={editForm.confirmPassword || ""} name="new-supervisor-confirm-password" autoComplete="new-password" onChange={e => setEditForm({...editForm, confirmPassword: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]" />
                  </div>
                </>
              )}
            </div>
            <div className="pt-4 flex gap-3">
              <button type="button" onClick={() => setEditOpen(false)} className="flex-1 px-4 py-2 rounded-xl border border-gray-200 text-gray-600 font-bold hover:bg-gray-50 transition">Cancel</button>
              <button type="submit" className="flex-1 px-4 py-2 rounded-xl bg-[#1D4ED8] text-white font-bold hover:bg-[#1E40AF] transition">Save Changes</button>
            </div>
          </form>
        )}
            </div>
          </div>
        )}

        {activeTab === "events" && (<>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4"> 
        <h2 className="font-heading text-xl font-bold text-[#0F2044]">Assigned Events</h2> 
        <div className="relative w-full sm:w-64"> 
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /> 
          <input value={eventSearch} onChange={e => setEventSearch(e.target.value)} placeholder="Search by event or venue…" className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-[#1A3C6E]" /> 
        </div> 
      </div> 

      {(eventStatusFilter !== "all" || eventDateFilter) && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {eventStatusFilter !== "all" && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1A3C6E]/10 text-[#1A3C6E] text-xs font-semibold">
              Status: {eventStatusFilter} <button onClick={() => setEventStatusFilter("all")}>×</button>
            </span>
          )}
          {eventDateFilter && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1A3C6E]/10 text-[#1A3C6E] text-xs font-semibold">
              Date: {eventDateFilter} <button onClick={() => setEventDateFilter("")}>×</button>
            </span>
          )}
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden mb-12">
        {filteredEvents.length === 0 ? (
          <EmptyState icon={<Calendar className="w-8 h-8" />} title={eventSearch ? "No events found" : "No assigned events"} subtitle={eventSearch ? `No events matching "${eventSearch}"` : "This supervisor hasn't been assigned to any events yet."} />
        ) : (
          <div className="overflow-x-auto w-full max-w-full">
            <table className="w-full text-sm min-w-[600px]">
            <thead className="bg-gray-50 text-gray-500 uppercase text-xs font-semibold">
              <tr>
                <th className="text-left px-5 py-3">Event Name</th>
                <th className="text-left px-5 py-3">Provider</th>
                <th className="text-left px-5 py-3 relative filter-dropdown-container">
                  <span 
                    onClick={() => setOpenDropdown(openDropdown === 'date' ? null : 'date')}
                    className={`flex items-center gap-1 cursor-pointer select-none ${eventDateFilter ? "text-[#1A3C6E] font-bold" : ""}`}
                  >
                    DATE <ChevronDown className={`w-3 h-3 ${eventDateFilter ? "text-[#1A3C6E]" : ""}`} />
                  </span>
                  {openDropdown === 'date' && (
                    <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg p-2 min-w-[160px] font-normal normal-case">
                      <input 
                        type="date" 
                        value={eventDateFilter}
                        onChange={(e) => { setEventDateFilter(e.target.value); setOpenDropdown(null); }}
                        className="w-full px-2 py-1 text-sm rounded border border-gray-200 outline-none"
                      />
                      <button onClick={() => { setEventDateFilter(""); setOpenDropdown(null); }} className="mt-2 w-full text-center text-xs text-red-500 hover:text-red-700">Clear</button>
                    </div>
                  )}
                </th>
                <th className="text-left px-5 py-3">Venue</th>
                <th className="text-left px-5 py-3 relative filter-dropdown-container">
                  <span 
                    onClick={() => setOpenDropdown(openDropdown === 'status' ? null : 'status')}
                    className={`flex items-center gap-1 cursor-pointer select-none ${eventStatusFilter !== "all" ? "text-[#1A3C6E] font-bold" : ""}`}
                  >
                    STATUS <ChevronDown className={`w-3 h-3 ${eventStatusFilter !== "all" ? "text-[#1A3C6E]" : ""}`} />
                  </span>
                  {openDropdown === 'status' && (
                    <div className="absolute top-full right-0 mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg p-1 min-w-[140px] font-normal normal-case text-left">
                      {["all", "active", "closed"].map(opt => (
                        <div key={opt} onClick={() => { setEventStatusFilter(opt); setOpenDropdown(null); }} className="px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-gray-50 flex items-center gap-2 capitalize">
                          {eventStatusFilter === opt ? <div className="w-2 h-2 rounded-full bg-[#1A3C6E]" /> : <div className="w-2 h-2" />}
                          {opt}
                        </div>
                      ))}
                    </div>
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              {paginatedEvents.map(e => (
                <tr key={e.id} onClick={() => nav(`/superadmin/events/${e.id}`)} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors group">
                  <td className="px-5 py-3 font-medium text-[#1A3C6E] group-hover:underline">{e.name}</td>
                  <td className="px-5 py-3 text-gray-600">{e.provider_name}</td>
                  <td className="px-5 py-3 text-gray-500">{e.date}</td>
                  <td className="px-5 py-3 text-gray-500">{e.venue}</td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${e.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                      {e.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredEvents.length > 10 && (
            <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between">
              <span className="text-sm text-gray-400">
                Showing {Math.min((eventsPage - 1) * 10 + 1, filteredEvents.length)}–{Math.min(eventsPage * 10, filteredEvents.length)} of {filteredEvents.length}
              </span>
              <div className="flex items-center gap-2">
                <button disabled={eventsPage === 1} onClick={() => setEventsPage(p => p - 1)}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Prev</button>
                <span className="px-3 py-1.5 rounded-lg bg-[#0F2044] text-white text-sm font-bold">{eventsPage}</span>
                <button disabled={eventsPage * 10 >= filteredEvents.length} onClick={() => setEventsPage(p => p + 1)}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Next</button>
              </div>
            </div>
          )}
          </div>
        )}
      </div>
        </>
        )}

{activeTab === "incidents" && (
  <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-gray-100">
      <h2 className="font-heading text-lg font-bold text-[#0F2044]">Incidents
        <span className="ml-2 text-sm font-normal text-gray-400">({filteredSupervisorIncidents.length} total)</span>
      </h2>
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={incidentSearch} onChange={e => { setIncidentSearch(e.target.value); setIncidentsPage(1); }}
          placeholder="Search incidents…"
          className="pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-[#1A3C6E] w-full sm:w-64" />
      </div>
    </div>
    {loadingIncidents ? (
      <div className="py-16 flex justify-center"><div className="w-8 h-8 border-4 border-[#1A3C6E] border-t-transparent rounded-full animate-spin" /></div>
    ) : (
      <div className="overflow-x-auto w-full max-w-full">
        <table className="w-full text-sm min-w-[600px]">
        <thead className="bg-gray-50 text-gray-500 uppercase text-xs tracking-wider">
          <tr>
            <th className="text-left px-6 py-3">Event</th>
            <th className="text-left px-6 py-3">Description</th>
            <th className="text-left px-6 py-3">Type</th>
            <th className="text-left px-6 py-3">Car</th>
            <th className="text-left px-6 py-3">Date</th>
            <th className="text-left px-6 py-3">Status</th>
            <th className="text-left px-6 py-3">Remark</th>
          </tr>
        </thead>
        <tbody>
          {paginatedSupervisorIncidents.length === 0 && (
            <tr><td colSpan="7" className="text-center text-gray-400 py-12">No incidents found</td></tr>
          )}
          {paginatedSupervisorIncidents.map((inc, i) => (
            <tr key={inc.id || i} className="border-t border-gray-100 hover:bg-[#F4F6FA] transition-colors">
              <td className="px-6 py-4 font-semibold text-[#1A3C6E]">{inc.event_name || "—"}</td>
              <td className="px-6 py-4 text-gray-600 max-w-xs truncate">{inc.description || "—"}</td>
              <td className="px-6 py-4">
                <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-gray-100 text-gray-700">
                  {(inc.incident_type || "UNKNOWN").replace(/_/g, " ").replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.substr(1).toLowerCase())}
                </span>
              </td>
              <td className="px-6 py-4 font-mono text-gray-500">{inc.plate || "—"}</td>
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
    {filteredSupervisorIncidents.length > 10 && (
      <div className="px-4 sm:px-6 py-4 border-t border-gray-100 flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-gray-400">Showing {Math.min((incidentsPage-1)*10+1, filteredSupervisorIncidents.length)}–{Math.min(incidentsPage*10, filteredSupervisorIncidents.length)} of {filteredSupervisorIncidents.length}</span>
        <div className="flex flex-wrap items-center gap-2">
          <button disabled={incidentsPage === 1} onClick={() => setIncidentsPage(p => p-1)} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Prev</button>
          <span className="px-3 py-1.5 rounded-lg bg-[#0F2044] text-white text-sm font-bold">{incidentsPage}</span>
          <button disabled={incidentsPage * 10 >= filteredSupervisorIncidents.length} onClick={() => setIncidentsPage(p => p+1)} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Next</button>
        </div>
      </div>
    )}
  </div>
)}

      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setLightbox(null)}>
          <button className="absolute top-6 right-6 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 p-2 rounded-full transition-colors z-[60]" onClick={() => setLightbox(null)}>
            <X className="w-6 h-6" />
          </button>
          <img src={lightbox} alt="Enlarged view" className="max-h-[90vh] max-w-[90vw] object-contain rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      </div>
    </SuperLayout>
  );
}
