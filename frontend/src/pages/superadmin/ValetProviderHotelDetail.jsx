import { useEffect, useState, useMemo, useRef } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import SuperLayout from "@/components/layout/SuperLayout";
import { State, City } from "country-state-city";
import { api } from "@/lib/api";
import { fmtDate, fmtDateTimeFull } from "@/lib/time";
import { toast } from "sonner";
import {
  ArrowLeft, Building2, MapPin, Phone, Mail, Clock,
  Car, Star, Calendar, Edit2, Save, X, Camera, Plus,
  Trash2, User, Users, ShieldCheck, CheckCircle2,
  QrCode, Copy, Download, Search, ChevronDown, Radio, AlertTriangle
} from "lucide-react";
import EmptyState from "@/components/ui/EmptyState";
import SkeletonTable from "@/components/ui/SkeletonTable";
import { QRCodeSVG } from "qrcode.react";
import StatusBadge from "@/components/ui/StatusBadge";

import { useScrollToFirstError } from "../../hooks/useScrollToFirstError";

export default function ValetProviderHotelDetail() {
  const { hid } = useParams();
  const nav = useNavigate();
  const hotelFieldRefs = useRef({});
  const scrollToFirstHotelError = useScrollToFirstError(["name", "address", "state", "city", "contact_person_name", "contact_person_phone", "contact_person_email", "total_valet_slots"], hotelFieldRefs);

  const eventFieldRefs = useRef({});
  const scrollToFirstEventError = useScrollToFirstError(["name", "host_email", "date", "end_date", "venue", "start_time", "end_time", "max_cars"], eventFieldRefs);
  const [hotel, setHotel] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showHotelQRModal, setShowHotelQRModal] = useState(false);

  // For assignments
  const [providerDrivers, setProviderDrivers] = useState([]);
  const [providerSupervisors, setProviderSupervisors] = useState([]);
  const [showAddDriver, setShowAddDriver] = useState(false);
  const [showAddSupervisor, setShowAddSupervisor] = useState(false);

  // Filters
  const [driverSearch, setDriverSearch] = useState("");
  const [supervisorSearch, setSupervisorSearch] = useState("");
  const [activeTab, setActiveTab] = useState("info");

  const [driversPage, setDriversPage] = useState(1);
  const [supervisorsPage, setSupervisorsPage] = useState(1);

  useEffect(() => { setDriversPage(1); }, [driverSearch]);
  useEffect(() => { setSupervisorsPage(1); }, [supervisorSearch]);

  const [eventTypeTab, setEventTypeTab] = useState("daily");
  const [dailyFilter, setDailyFilter] = useState("active");
  const [specialFilter, setSpecialFilter] = useState("active");
  const [dailyEvents, setDailyEvents] = useState([]);
  const [specialEvents, setSpecialEvents] = useState([]);
  const [dailyTotal, setDailyTotal] = useState(0);
  const [specialTotal, setSpecialTotal] = useState(0);
  const [dailyPage, setDailyPage] = useState(1);
  const [specialPage, setSpecialPage] = useState(1);
  const [loadingEvents, setLoadingEvents] = useState(false);

  const [hotelCars, setHotelCars] = useState([]);
  const [loadingHotelCars, setLoadingHotelCars] = useState(false);
  const [hotelCarSearch, setHotelCarSearch] = useState("");
  const [hotelCarsPage, setHotelCarsPage] = useState(1);

  const [hotelIncidents, setHotelIncidents] = useState([]);
  const [loadingHotelIncidents, setLoadingHotelIncidents] = useState(false);
  const [hotelIncidentSearch, setHotelIncidentSearch] = useState("");
  const [hotelIncidentsPage, setHotelIncidentsPage] = useState(1);

  const [hotelLiveEvents, setHotelLiveEvents] = useState([]);
  const [selectedHotelLiveEvent, setSelectedHotelLiveEvent] = useState(null);
  const [hotelLiveQueue, setHotelLiveQueue] = useState([]);
  const [loadingHotelQueue, setLoadingHotelQueue] = useState(false);
  const [hotelLiveEventSearch, setHotelLiveEventSearch] = useState("");
  const [openDropdown, setOpenDropdown] = useState(null);



  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest('.filter-dropdown-container')) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Inline editing
  const [editing, setEditing] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [uploading, setUploading] = useState(false);

  // Hotel info edit mode
  const [editHotelOpen, setEditHotelOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    address: "",
    city: "",
    state: "",
    total_valet_slots: "",
    gate_timer_minutes: "",
    allow_instant_park: false,
    contact_person_name: "",
    contact_person_phone: "",
    contact_person_email: "",
    zones: [],
    gates: []
  });
  const [editErrors, setEditErrors] = useState({});

  // QR Modal
  const [qrModalEvent, setQrModalEvent] = useState(null);
  const [qrToken, setQrToken] = useState(null);

  const [showEventModal, setShowEventModal] = useState(false);
  const [eventErrors, setEventErrors] = useState({});
  const [eventForm, setEventForm] = useState({
    name: "", date: "", end_date: "", venue: "", max_cars: 50,
    gates: ["Main Gate"], start_time: "", end_time: "",
    zones: [{ name: "A", slots: 20 }],
    host_name: "", host_email: "", allow_instant_park: false
  });
  const totalEventSlots = eventForm.zones.reduce((sum, z) => sum + (parseInt(z.slots) || 0), 0);

  const createEventModalRef = useRef(null);
  useEffect(() => { if (showEventModal && createEventModalRef.current) createEventModalRef.current.scrollTop = 0; }, [showEventModal]);
  const driverModalRef = useRef(null);
  useEffect(() => { if (showAddDriver && driverModalRef.current) driverModalRef.current.scrollTop = 0; }, [showAddDriver]);
  const supervisorModalRef = useRef(null);
  useEffect(() => { if (showAddSupervisor && supervisorModalRef.current) supervisorModalRef.current.scrollTop = 0; }, [showAddSupervisor]);

  useEffect(() => {
    if (!editHotelOpen && !qrModalEvent && !showEventModal) return;
    const handleEsc = (e) => {
      if (e.key === "Escape") {
        if (qrModalEvent) { setQrModalEvent(null); setQrToken(null); }
        else if (showEventModal) setShowEventModal(false);
        else if (editHotelOpen) setEditHotelOpen(false); setEditErrors({});
      }
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [editHotelOpen, qrModalEvent, showEventModal]);

  const handleShowQr = async (e) => {
    setQrModalEvent(e);
    try {
      const { data } = await api.get(`/hotels/${hid}/events/${e.id}/qr-token`);
      setQrToken(data.event_qr_token);
    } catch {
      toast.error("Failed to load QR token");
      setQrModalEvent(null);
    }
  };

  const validateEvent = () => {
    const errs = {};
    if (!eventForm.name?.trim()) errs.name = "Event name is required";
    if (eventForm.host_email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(eventForm.host_email.trim())) errs.host_email = "Please enter a valid email address";
    if (!eventForm.date) errs.date = "Start date is required";
    if (!eventForm.end_date) errs.end_date = "End date is required";
    else if (eventForm.date && eventForm.end_date < eventForm.date) errs.end_date = "End date cannot be before start date";
    if (!eventForm.venue?.trim()) errs.venue = "Venue is required";
    if (!eventForm.start_time) errs.start_time = "Start time is required";
    if (!eventForm.end_time) errs.end_time = "End time is required";
    if (!eventForm.max_cars || eventForm.max_cars < 1) errs.max_cars = "Max cars must be at least 1";
    return errs;
  };

  const handleCreateEvent = async (e) => {
    e.preventDefault();
    const errs = validateEvent();
    setEventErrors(errs);
    if (Object.keys(errs).length > 0) {
      scrollToFirstEventError(errs);
      return;
    }
    if (totalEventSlots > eventForm.max_cars) {
      toast.error(`Total zone slots (${totalEventSlots}) cannot exceed max cars (${eventForm.max_cars}). Reduce zone slots.`);
      return;
    }
    try {
      const body = {
        ...eventForm,
        event_type: "hotel_special",
        hotel_id: hid,
        gates: eventForm.gates.filter(g => g.trim()),
        zones: eventForm.zones.filter(z => z.name.trim())
      };
      const res = await api.post(`/hotels/${hid}/events`, body);
      if (eventForm.host_name?.trim() && eventForm.host_email?.trim()) {
        try {
          await api.patch(`/events/${res.data.id}/host`, {
            host_name: eventForm.host_name.trim(),
            host_email: eventForm.host_email.trim()
          });
          toast.success("Special event created and host invited!");
        } catch (err) {
          toast.error("Event created, but host invite failed to send.");
        }
      } else {
        toast.success("Special event created!");
      }
      setShowEventModal(false);
      setEventForm({ name: "", date: "", end_date: "", venue: "", max_cars: 50, gates: ["Main Gate"], start_time: "", end_time: "", zones: [{ name: "A", slots: 20 }], host_name: "", host_email: "", allow_instant_park: false });
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to create event");
    }
  };

  const loadData = async () => {
    try {
      const [resHotel, resDetail] = await Promise.all([
        api.get(`/hotels/${hid}`),
        api.get(`/hotels/${hid}/detail`)
      ]);
      setHotel(resHotel.data);
      setDetail(resDetail.data);

      // Initialize edit form
      const h = resHotel.data;
      setEditForm({
        name: h.name || "",
        address: h.address || "",
        city: h.city || "",
        state: h.state || "",
        total_valet_slots: h.total_valet_slots || "",
        gate_timer_minutes: h.gate_timer_minutes || "",
        allow_instant_park: !!h.allow_instant_park,
        contact_person_name: h.contact_person_name || "",
        contact_person_phone: h.contact_person_phone || "",
        contact_person_email: h.contact_person_email || "",
        zones: h.zones || [{ name: "A", slots: h.total_valet_slots || 50 }],
        gates: h.gates || ["Main Gate"]
      });

      // Fetch all provider's drivers/supervisors for the "Add" dropdowns
      const pid = resHotel.data.provider_id;
      const [resProvDrivers, resProvSups] = await Promise.all([
        api.get(`/drivers?provider_id=${pid}`),
        api.get(`/supervisors?provider_id=${pid}`)
      ]);
      // Filter out drivers belonging to other providers just in case (though API should handle)
      setProviderDrivers(resProvDrivers.data.filter(d => d.provider_id === pid));
      setProviderSupervisors(resProvSups.data.filter(s => s.provider_id === pid));

    } catch (err) {
      toast.error("Failed to load hotel details");
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadData(); }, [hid]);

  useEffect(() => {
    if (activeTab === "cars" && hotelCars.length === 0) {
      setLoadingHotelCars(true);
      api.get(`/hotels/${hid}/cars`)
        .then(r => setHotelCars(r.data))
        .catch(() => toast.error("Failed to load cars"))
        .finally(() => setLoadingHotelCars(false));
    }
    if (activeTab === "incidents" && hotelIncidents.length === 0) {
      setLoadingHotelIncidents(true);
      api.get(`/hotels/${hid}/incidents`)
        .then(r => setHotelIncidents(r.data))
        .catch(() => toast.error("Failed to load incidents"))
        .finally(() => setLoadingHotelIncidents(false));
    }
    if (activeTab === "queue") {
      const activeEvents = [...dailyEvents, ...specialEvents].filter(e => e.status === "active");
      setHotelLiveEvents(activeEvents);
      if (activeEvents.length === 1) setSelectedHotelLiveEvent(activeEvents[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, dailyEvents, specialEvents, hid]);

  useEffect(() => {
    if (!selectedHotelLiveEvent) return;
    setLoadingHotelQueue(true);
    api.get(`/events/${selectedHotelLiveEvent.id}/queue`)
      .then(r => setHotelLiveQueue(r.data))
      .catch(() => { })
      .finally(() => setLoadingHotelQueue(false));
    const interval = setInterval(() => {
      api.get(`/events/${selectedHotelLiveEvent.id}/queue`)
        .then(r => setHotelLiveQueue(r.data)).catch(() => { });
    }, 5000);
    return () => clearInterval(interval);
  }, [selectedHotelLiveEvent]);

  const generateHotelPDF = async () => {
    try {
      const h = hotel;
      const s = detail?.stats;
      const events = detail?.recent_events || [];
      const drivers = detail?.assigned_drivers || [];
      const supervisors = detail?.assigned_supervisors || [];

      const formatPdfDate = (iso) => {
        if (!iso) return "—";
        try {
          return fmtDate(iso);
        } catch { return "—"; }
      };

      const eventRows = events.map(e => `
        <tr>
          <td style="padding:8px 10px;font-weight:700;">${e.name}</td>
          <td style="padding:8px 10px;">${e.date || "—"}</td>
          <td style="padding:8px 10px;">${e.event_type === "hotel_daily" ? "Daily" : "Special"}</td>
          <td style="padding:8px 10px;"><span style="background:${e.status === "closed" ? "#D1FAE5" : "#FEF3C7"};color:${e.status === "closed" ? "#065F46" : "#92400E"};padding:2px 8px;border-radius:99px;font-size:11px;">${e.status}</span></td>
        </tr>`).join("");

      const driverRows = drivers.map(d => `
        <tr>
          <td style="padding:8px 10px;font-weight:700;">${d.name}</td>
          <td style="padding:8px 10px;">${d.phone || "—"}</td>
          <td style="padding:8px 10px;"><span style="background:${d.is_active !== false ? "#D1FAE5" : "#FEE2E2"};color:${d.is_active !== false ? "#065F46" : "#991B1B"};padding:2px 8px;border-radius:99px;font-size:11px;">${d.is_active !== false ? "Active" : "Inactive"}</span></td>
        </tr>`).join("");

      const supervisorRows = supervisors.map(s => `
        <tr>
          <td style="padding:8px 10px;font-weight:700;">${s.name}</td>
          <td style="padding:8px 10px;">${s.phone || "—"}</td>
          <td style="padding:8px 10px;"><span style="background:${s.is_active !== false ? "#D1FAE5" : "#FEE2E2"};color:${s.is_active !== false ? "#065F46" : "#991B1B"};padding:2px 8px;border-radius:99px;font-size:11px;">${s.is_active !== false ? "Active" : "Inactive"}</span></td>
        </tr>`).join("");

      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
      <style>
        *{margin:0;padding:0;box-sizing:border-box;}
        body{font-family:Arial,sans-serif;color:#111827;font-size:13px;}
        .header{background:#1D4ED8;color:white;padding:28px 32px;}
        .header h1{font-size:24px;font-weight:900;}
        .header p{opacity:0.7;margin-top:4px;font-size:13px;}
        .section{padding:22px 32px;border-bottom:1px solid #f3f4f6;}
        .section h2{font-size:11px;font-weight:800;color:#0F2044;letter-spacing:3px;margin-bottom:14px;text-transform:uppercase;}
        .stats{display:flex;gap:12px;flex-wrap:wrap;}
        .stat{background:#f9fafb;border-radius:10px;padding:12px 16px;text-align:center;flex:1;min-width:80px;}
        .stat-val{font-size:22px;font-weight:900;color:#111827;}
        .stat-lbl{font-size:9px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-top:3px;}
        table{width:100%;border-collapse:collapse;font-size:12px;}
        th{padding:8px 10px;text-align:left;background:#f9fafb;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;font-weight:700;border-bottom:1px solid #e5e7eb;}
        .footer{padding:16px 32px;text-align:center;color:#9ca3af;font-size:11px;}
        .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
        .info-item label{font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:2px;}
        .info-item span{font-size:13px;font-weight:700;color:#111827;}
      </style></head><body>
      <div class="header">
        <h1>${h.name}</h1>
        <p>${h.address || "—"} · ${h.city || "—"}, ${h.state || "—"}</p>
        <p style="margin-top:8px;font-size:11px;opacity:0.5;">Hotel Report · Generated ${fmtDateTimeFull(new Date().toISOString())}</p>
      </div>
      <div class="section">
        <h2>Hotel Information</h2>
        <div class="info-grid">
          <div class="info-item"><label>Contact Person</label><span>${h.contact_person_name || "—"}</span></div>
          <div class="info-item"><label>Contact Phone</label><span>${h.contact_person_phone || "—"}</span></div>
          <div class="info-item"><label>Valet Slots</label><span>${h.total_valet_slots || "—"}</span></div>
          <div class="info-item"><label>Operating Hours</label><span>${h.operating_hours_start || "—"} – ${h.operating_hours_end || "—"}</span></div>
          <div class="info-item"><label>Gates</label><span>${h.gates?.join(", ") || "Main Gate"}</span></div>

        </div>
      </div>
      <div class="section">
        <h2>Summary</h2>
        <div class="stats">
          ${[
          ["Total Events", s?.total_events ?? 0],
          ["Cars Served", s?.total_cars_served ?? 0],
          ["Platform Rating", s?.platform_avg_rating > 0 ? s.platform_avg_rating + "★" : "-"],
          ["Drivers", drivers.length],
          ["Supervisors", supervisors.length],
        ].map(([label, value]) => `<div class="stat"><div class="stat-val">${value}</div><div class="stat-lbl">${label}</div></div>`).join("")}
        </div>
      </div>
      ${events.length > 0 ? `<div class="section"><h2>Events (${events.length})</h2>
        <table><thead><tr><th>Event</th><th>Date</th><th>Type</th><th>Status</th></tr></thead>
        <tbody>${eventRows}</tbody></table></div>` : ""}
      ${drivers.length > 0 ? `<div class="section"><h2>Assigned Drivers (${drivers.length})</h2>
        <table><thead><tr><th>Name</th><th>Phone</th><th>Status</th></tr></thead>
        <tbody>${driverRows}</tbody></table></div>` : ""}
      ${supervisors.length > 0 ? `<div class="section"><h2>Assigned Supervisors (${supervisors.length})</h2>
        <table><thead><tr><th>Name</th><th>Phone</th><th>Status</th></tr></thead>
        <tbody>${supervisorRows}</tbody></table></div>` : ""}
      <div class="footer">InstaPark — Smart Valet Operations · ${h.name} Hotel Report</div>
      </body></html>`;

      const w = window.open("", "_blank");
      w.document.write(html);
      w.document.close();
      setTimeout(() => w.print(), 500);
      toast.success("Hotel report ready to print/save");
    } catch {
      toast.error("Failed to generate hotel report");
    }
  };

  const handleUpdate = async (field, value) => {
    try {
      await api.patch(`/hotels/${hid}`, { [field]: value });
      setHotel({ ...hotel, [field]: value });
      setEditing(null);
      if (field === 'is_active') {
        toast.success(value ? "Marked active" : "Marked inactive");
      } else {
        toast.success("Updated successfully");
      }
    } catch {
      toast.error("Failed to update");
    }
  };

    const validateEdit = () => {
    const errs = {};
    if (!editForm.name?.trim()) errs.name = "Hotel name cannot be empty";
    if (!editForm.address?.trim()) errs.address = "Address cannot be empty";
    if (!editForm.city?.trim()) errs.city = "City cannot be empty";
    if (!editForm.state?.trim()) errs.state = "State cannot be empty";
    if (!editForm.contact_person_name?.trim()) errs.contact_person_name = "Contact person name cannot be empty";
    if (editForm.contact_person_phone && !/^\d{10}$/.test(editForm.contact_person_phone.replace(/\D/g, ""))) errs.contact_person_phone = "Contact person phone must be exactly 10 digits";
    if (editForm.contact_person_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editForm.contact_person_email.trim())) errs.contact_person_email = "Please enter a valid contact email address";
    if (!editForm.total_valet_slots || parseInt(editForm.total_valet_slots) < 1) errs.total_valet_slots = "Total valet slots must be at least 1";
    return errs;
  };

  const handleSaveHotel = async (e) => {
    e.preventDefault();
    const errs = validateEdit();
    setEditErrors(errs);
    if (Object.keys(errs).length > 0) {
      scrollToFirstHotelError(errs);
      return;
    }
    try {
      const body = {
        name: editForm.name,
        address: editForm.address,
        city: editForm.city,
        state: editForm.state,
        total_valet_slots: parseInt(editForm.total_valet_slots),
        gate_timer_minutes: editForm.gate_timer_minutes ? parseInt(editForm.gate_timer_minutes) : null,
        allow_instant_park: editForm.allow_instant_park,
        contact_person_name: editForm.contact_person_name,
        contact_person_phone: editForm.contact_person_phone,
        contact_person_email: editForm.contact_person_email || null,
        zones: editForm.zones.map(z => ({ name: z.name.trim(), slots: parseInt(z.slots) || 0 })).filter(z => z.name),
        gates: editForm.gates.filter(g => g.trim()),
      };
      await api.patch(`/hotels/${hid}`, body);
      toast.success("Hotel updated successfully");
      setEditHotelOpen(false); setEditErrors({});
      loadData();
    } catch {
      toast.error("Failed to update hotel");
    }
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "hotels");
      const { data } = await api.post("/upload", fd);
      await api.patch(`/hotels/${hid}`, { hotel_photo: data.url });
      setHotel({ ...hotel, hotel_photo: data.url });
      toast.success("Photo updated");
    } catch {
      toast.error("Photo upload failed");
    } finally {
      setUploading(false);
    }
  };

  const assignDriver = async (did) => {
    try {
      await api.post(`/hotels/${hid}/drivers/${did}`);
      toast.success("Driver assigned");
      setShowAddDriver(false);
      loadData();
    } catch { toast.error("Failed to assign driver"); }
  };

  const removeDriver = async (did) => {
    if (!confirm("Remove this driver from the hotel?")) return;
    try {
      await api.delete(`/hotels/${hid}/drivers/${did}`);
      toast.success("Driver removed");
      loadData();
    } catch { toast.error("Failed to remove driver"); }
  };

  const assignSupervisor = async (sid) => {
    try {
      await api.post(`/hotels/${hid}/supervisors/${sid}`);
      toast.success("Supervisor assigned");
      setShowAddSupervisor(false);
      loadData();
    } catch { toast.error("Failed to assign supervisor"); }
  };

  const removeSupervisor = async (sid) => {
    if (!confirm("Remove this supervisor from the hotel?")) return;
    try {
      await api.delete(`/hotels/${hid}/supervisors/${sid}`);
      toast.success("Supervisor removed");
      loadData();
    } catch { toast.error("Failed to remove supervisor"); }
  };

  const unassignedDrivers = useMemo(() => {
    const assignedIds = new Set(hotel?.assigned_driver_ids || []);
    return providerDrivers.filter(d => !assignedIds.has(d.id));
  }, [providerDrivers, hotel]);

  const unassignedSupervisors = useMemo(() => {
    const assignedIds = new Set(hotel?.assigned_supervisor_ids || []);
    return providerSupervisors.filter(s => !assignedIds.has(s.id));
  }, [providerSupervisors, hotel]);


  const filteredHotelCars = useMemo(() =>
    hotelCars.filter(c =>
      !hotelCarSearch || c.plate?.toLowerCase().includes(hotelCarSearch.toLowerCase()) ||
      c.make?.toLowerCase().includes(hotelCarSearch.toLowerCase())
    ), [hotelCars, hotelCarSearch]);
  const paginatedHotelCars = filteredHotelCars.slice((hotelCarsPage - 1) * 10, hotelCarsPage * 10);

  const filteredHotelIncidents = useMemo(() =>
    hotelIncidents.filter(i =>
      !hotelIncidentSearch || i.description?.toLowerCase().includes(hotelIncidentSearch.toLowerCase()) ||
      i.event_name?.toLowerCase().includes(hotelIncidentSearch.toLowerCase())
    ), [hotelIncidents, hotelIncidentSearch]);
  const paginatedHotelIncidents = filteredHotelIncidents.slice((hotelIncidentsPage - 1) * 10, hotelIncidentsPage * 10);
  const filteredDrivers = useMemo(() => {
    if (!detail?.assigned_drivers) return [];
    if (!driverSearch) return detail.assigned_drivers;
    const q = driverSearch.toLowerCase();
    return detail.assigned_drivers.filter(d =>
      d.name?.toLowerCase().includes(q) ||
      d.employee_id?.toLowerCase().includes(q)
    );
  }, [detail?.assigned_drivers, driverSearch]);

  const filteredSupervisors = useMemo(() => {
    if (!detail?.assigned_supervisors) return [];
    if (!supervisorSearch) return detail.assigned_supervisors;
    const q = supervisorSearch.toLowerCase();
    return detail.assigned_supervisors.filter(s =>
      s.name?.toLowerCase().includes(q) ||
      s.email?.toLowerCase().includes(q)
    );
  }, [detail?.assigned_supervisors, supervisorSearch]);

  const paginatedDrivers = filteredDrivers.slice((driversPage - 1) * 10, driversPage * 10);
  const paginatedSupervisors = filteredSupervisors.slice((supervisorsPage - 1) * 10, supervisorsPage * 10);


  const fetchEvents = async (type, status, page) => {
    setLoadingEvents(true);
    try {
      const res = await api.get(`/hotels/${hid}/events`, {
        params: { event_type: type, status, page, page_size: 20 }
      });
      if (type === "hotel_daily") {
        setDailyEvents(res.data.events || []);
        setDailyTotal(res.data.total || 0);
        setDailyPage(res.data.page || page);
      } else {
        setSpecialEvents(res.data.events || []);
        setSpecialTotal(res.data.total || 0);
        setSpecialPage(res.data.page || page);
      }
    } catch (e) {
      console.error("Failed to fetch events", e);
    } finally {
      setLoadingEvents(false);
    }
  };

  useEffect(() => {
    fetchEvents("hotel_daily", "active", 1);
    fetchEvents("hotel_special", "active", 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hid]);

  useEffect(() => {
    fetchEvents("hotel_daily", dailyFilter, dailyPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyFilter, dailyPage]);

  useEffect(() => {
    fetchEvents("hotel_special", specialFilter, specialPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specialFilter, specialPage]);


  const totalSlots = useMemo(() =>
    editForm.zones.reduce((sum, z) => sum + (parseInt(z.slots) || 0), 0),
    [editForm.zones]);

  if (loading) return (
    <SuperLayout title="Hotel Detail">
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="w-10 h-10 rounded-full border-4 border-[#1A3C6E] border-t-transparent animate-spin" />
        <p className="text-gray-400 text-sm font-medium">Loading...</p>
      </div>
    </SuperLayout>
  );
  if (!hotel) return <SuperLayout title="Hotel Detail"><div className="p-8 text-center text-gray-400">Hotel not found</div></SuperLayout>;

  return (
    <SuperLayout title="Hotel Detail">
      <Link to={hotel ? `/superadmin/providers/${hotel.provider_id}` : "/superadmin/providers"}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-[#1D4ED8] hover:text-[#1E40AF] mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Valet Provider
      </Link>

      <div className="bg-[#0F2044] rounded-2xl overflow-hidden shadow-card">
        <div className="px-4 sm:px-8 pt-4 sm:pt-8 pb-4 sm:pb-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            {/* LEFT */}
            <div className="flex items-start gap-4 min-w-0">
              {hotel.hotel_photo ? (
                <div className="relative group shrink-0">
                  <img src={hotel.hotel_photo} alt={hotel.name} className="w-16 h-16 rounded-2xl object-cover border-2 border-white/20 shadow-lg" />
                  <button
                    type="button"
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        await api.patch(`/hotels/${hid}`, { hotel_photo: null });
                        setHotel(prev => ({ ...prev, hotel_photo: null }));
                        toast.success("Photo removed");
                      } catch {
                        toast.error("Failed to remove photo");
                      }
                    }}
                    className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-400 hover:text-red-500 hover:border-red-200 transition-all z-10"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <span className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center text-2xl shrink-0 shadow-lg">🏨</span>
              )}

              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h1 className="font-heading text-2xl font-bold text-white truncate">{hotel.name}</h1>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${hotel?.is_active ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/30" : "bg-red-500/20 text-red-300 border border-red-400/30"}`}>
                    {hotel?.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
                <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mt-0.5">Hotel Profile & Operations</p>

                <div className="mt-4 pt-4 border-t border-white/10 grid grid-cols-3 sm:grid-cols-7 gap-2">
                  {[
                    { label: "Total Events", value: detail?.stats?.total_events ?? "—", icon: Calendar, tab: "events" },
                    { label: "Cars Served", value: detail?.stats?.total_cars_served ?? "—", icon: Car, tab: "cars" },
                    { label: "Platform Rating", value: detail?.stats?.platform_avg_rating > 0 ? detail.stats.platform_avg_rating + "★" : "—", icon: Star, tab: null },
                    { label: "Drivers", value: detail?.assigned_drivers?.length ?? 0, icon: Users, tab: "drivers" },
                    { label: "Supervisors", value: detail?.assigned_supervisors?.length ?? 0, icon: ShieldCheck, tab: "supervisors" },
                    { label: "Incidents", value: detail?.stats?.incidents ?? "—", icon: AlertTriangle, tab: "incidents" }
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
            <div className="flex flex-row flex-wrap items-start gap-2 shrink-0 self-start">

              <button
                onClick={generateHotelPDF}
                className="flex items-center gap-2 px-3 py-2 sm:px-4 sm:py-2 text-sm rounded-xl border border-white/30 text-white bg-white/10 hover:bg-white/20 transition font-semibold"
              >
                <Download className="w-4 h-4" /> Download Report
              </button>
              <button
                onClick={() => {
                  const action = hotel.is_active ? "mark this hotel inactive" : "mark this hotel active";
                  if (!window.confirm(`Are you sure you want to ${action}?`)) return;
                  handleUpdate('is_active', !hotel.is_active);
                }}
                className={`px-3 py-2 sm:px-4 sm:py-2 text-sm rounded-xl font-semibold transition border ${hotel?.is_active
                    ? "border-red-400 bg-red-500/20 text-red-100 hover:bg-red-500/40"
                    : "border-emerald-300 bg-emerald-500 text-white hover:bg-emerald-600"
                  }`}
              >
                {hotel?.is_active ? "Inactive" : "Active"}
              </button>
              {hotel.hotel_qr_token && (
                <>
                  {/* Mobile: icon button only */}
                  <button
                    className="sm:hidden flex items-center justify-center w-9 h-9 rounded-xl bg-white/10 border border-white/20 hover:bg-white/20 transition"
                    onClick={() => setShowHotelQRModal(true)}
                    title="Hotel QR"
                  >
                    <QrCode className="w-5 h-5 text-white/80" />
                  </button>

                  {/* Desktop: full QR block */}
                  <div className="hidden sm:flex flex-row items-center gap-3 bg-white/10 border border-white/20 rounded-xl p-3">
                    <div className="bg-white rounded-lg p-1.5 cursor-pointer" onClick={() => setShowHotelQRModal(true)}>
                      <QRCodeSVG className="hotel-qr-svg" value={`${window.location.origin}/hotel-register/${hotel.hotel_qr_token}`} size={72} />
                    </div>
                    <div className="flex flex-col gap-1 items-start">
                      <div className="text-[10px] text-white/60 uppercase font-bold tracking-wider">Hotel QR</div>
                      <button
                        onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/hotel-register/${hotel.hotel_qr_token}`); toast.success("Link copied!"); }}
                        className="text-xs text-white/80 hover:text-white underline text-left"
                      >
                        Copy Link
                      </button>
                      <button
                        onClick={() => {
                          const canvas = document.createElement("canvas");
                          const size = 400;
                          canvas.width = size;
                          canvas.height = size;
                          const ctx = canvas.getContext("2d");
                          ctx.fillStyle = "#EFF6FF";
                          ctx.fillRect(0, 0, size, size);
                          const svg = document.querySelector(".hotel-qr-svg");
                          if (!svg) { toast.error("QR code not found"); return; }
                          const svgData = new XMLSerializer().serializeToString(svg);
                          const img = new Image();
                          img.onload = () => {
                            ctx.drawImage(img, 20, 20, size - 40, size - 40);
                            const a = document.createElement("a");
                            a.download = `${hotel.name}-valet-qr.png`;
                            a.href = canvas.toDataURL("image/png");
                            a.click();
                          };
                          img.src = "data:image/svg+xml;base64," + btoa(svgData);
                        }}
                        className="flex items-center gap-1 text-xs text-white/80 hover:text-white text-left"
                      >
                        <Download className="w-3 h-3" /> Download
                      </button>
                    </div>
                  </div>
                </>
              )}
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
            { id: "queue", label: "Live Queue", icon: Radio },
            { id: "incidents", label: "Incidents", icon: AlertTriangle }
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

      <div className="mt-6">
        {activeTab === "info" && (
          <div className="grid grid-cols-1 gap-6">
            <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <h3 className="font-heading text-lg font-bold text-[#0F2044]">Hotel Information</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative group">
                    <label className="cursor-pointer p-2 rounded-lg bg-gray-50 text-gray-400 hover:text-[#1D4ED8] hover:bg-blue-50 transition-all">
                      <Camera className="w-4 h-4" />
                      <input type="file" className="hidden" accept="image/*" onChange={handlePhotoUpload} disabled={uploading} />
                      <span className="text-red-500">*</span></label>
                  </div>
                  <button onClick={() => setEditHotelOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1D4ED8] text-white text-xs font-bold hover:bg-[#1E40AF] transition-all">
                    <Edit2 className="w-3.5 h-3.5" /> Edit
                  </button>
                </div>
              </div>

              {!editHotelOpen ? (
                <div className="space-y-6">
                  {[
                    { label: "Name", key: "name", value: hotel.name, icon: Building2 },
                    { label: "Address", key: "address", value: hotel.address, icon: MapPin },
                    { label: "City", key: "city", value: hotel.city, icon: MapPin },
                    { label: "State", key: "state", value: hotel.state, icon: MapPin },
                    { label: "Valet Slots", key: "total_valet_slots", value: hotel.total_valet_slots, icon: Car },
                  ].map((f) => (
                    <div key={f.key}>
                      <div className="text-[10px] uppercase font-bold text-gray-400 mb-1">
                        {f.label}
                      </div>
                      <div className="flex items-center gap-2 text-sm font-bold text-[#0F2044]">
                        <f.icon className="w-3.5 h-3.5 text-gray-300" />
                        {f.value}
                      </div>
                    </div>
                  ))}

                  <div className="pt-4 border-t border-gray-50">
                    <div className="text-[10px] uppercase font-bold text-gray-400 mb-3">Contact Person</div>
                    <div className="space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-gray-400"><User className="w-4 h-4" /></div>
                        <div>
                          <div className="text-xs font-bold text-[#0F2044]">{hotel.contact_person_name}</div>
                          <div className="text-[10px] text-gray-500">Name</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-gray-400"><Phone className="w-4 h-4" /></div>
                        <div>
                          <div className="text-xs font-bold text-[#0F2044]">{hotel.contact_person_phone}</div>
                          <div className="text-[10px] text-gray-500">Phone</div>
                        </div>
                      </div>
                      {hotel.contact_person_email && (
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-gray-400"><Mail className="w-4 h-4" /></div>
                          <div>
                            <div className="text-xs font-bold text-[#0F2044]">{hotel.contact_person_email}</div>
                            <div className="text-[10px] text-gray-500">Email</div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="pt-4 border-t border-gray-50">
                    <div className="text-[10px] uppercase font-bold text-gray-400 mb-1">Gates</div>
                    <div className="text-sm font-bold text-[#0F2044]">
                      {hotel.gates?.join(", ") || "Main Gate"}
                    </div>
                  </div>

                  <div className="pt-4 border-t border-gray-50">
                    <div className="text-[10px] uppercase font-bold text-gray-400 mb-1">Parking Zones</div>
                    <div className="text-sm font-bold text-[#0F2044]">
                      {hotel.zones && hotel.zones.length > 0
                        ? hotel.zones.map(z => `${z.name} — ${z.slots} slots`).join(", ")
                        : `Default (Single zone — ${hotel.total_valet_slots} slots)`
                      }
                    </div>
                  </div>



                  <div className="pt-4 border-t border-gray-50 flex items-center justify-end">
                    <div className="text-right">
                      <div className="text-[10px] uppercase font-bold text-gray-400 mb-1">Created</div>
                      <div className="text-xs font-bold text-gray-600 tabular-nums">{fmtDate(hotel.created_at)}</div>
                    </div>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSaveHotel} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Name</label>
                    <input ref={el => { if (hotelFieldRefs.current) hotelFieldRefs.current.name = el; }} 
                      type="text"
                      value={editForm.name}
                      onChange={(e) => { setEditForm({ ...editForm, name: e.target.value}); if (editErrors.name) setEditErrors(prev => ({ ...prev, name: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${editErrors.name ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`}
                    />
{ editErrors.name && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.name}</p> }
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Address</label>
                    <input ref={el => { if (hotelFieldRefs.current) hotelFieldRefs.current.address = el; }} 
                      type="text"
                      value={editForm.address}
                      onChange={(e) => { setEditForm(prev => ({ ...prev, address: e.target.value})); if (editErrors.address) setEditErrors(prev => ({ ...prev, address: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${editErrors.address ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`}
                    />
{ editErrors.address && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.address}</p> }
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">State <span className="text-red-500">*</span></label>
                      <select ref={el => { if (hotelFieldRefs.current) hotelFieldRefs.current.state = el; }} 
                        value={editForm.state || ""}
                        onChange={e => { setEditForm(prev => ({ ...prev, state: e.target.value, city: "" })); if (editErrors.state) setEditErrors(prev => ({ ...prev, state: undefined })); }}
                        className={`w-full px-4 py-2 rounded-xl border ${editErrors.state ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`}
                      >
                        <option value="">Select State</option>
                        {State.getStatesOfCountry("IN").map(s => (
                          <option key={s.isoCode} value={s.name}>{s.name}</option>
                        ))}
                      </select>
                      {editErrors.state && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.state}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">City <span className="text-red-500">*</span></label>
                      <select ref={el => { if (hotelFieldRefs.current) hotelFieldRefs.current.city = el; }} 
                        value={editForm.city || ""}
                        onChange={e => { setEditForm(prev => ({ ...prev, city: e.target.value })); if (editErrors.city) setEditErrors(prev => ({ ...prev, city: undefined })); }}
                        disabled={!editForm.state}
                        className={`w-full px-4 py-2 rounded-xl border ${editErrors.city ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        <option value="">Select City</option>
                        {(editForm.state
                          ? City.getCitiesOfState("IN", State.getStatesOfCountry("IN").find(s => s.name === editForm.state)?.isoCode || "")
                          : []
                        ).map(c => (
                          <option key={c.name} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                      {editErrors.city && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.city}</p>}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Total Valet Slots</label>
                    <input ref={el => { if (hotelFieldRefs.current) hotelFieldRefs.current.total_valet_slots = el; }} 
                      type="number"
                      min={1}
                      value={editForm.total_valet_slots}
                      onChange={(e) => { setEditForm({ ...editForm, total_valet_slots: e.target.value}); if (editErrors.total_valet_slots) setEditErrors(prev => ({ ...prev, total_valet_slots: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${editErrors.total_valet_slots ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`}
                    />
{ editErrors.total_valet_slots && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.total_valet_slots}</p> }
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Gate Wait Timer (min)</label>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={editForm.gate_timer_minutes}
                      onChange={(e) => { setEditForm({ ...editForm, gate_timer_minutes: e.target.value}); if (editErrors.gate_timer_minutes) setEditErrors(prev => ({ ...prev, gate_timer_minutes: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${editErrors.gate_timer_minutes ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`}
                    />
{ editErrors.gate_timer_minutes && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.gate_timer_minutes}</p> }
                    <p className="text-xs text-gray-400 mt-1">Default timer for this hotel's daily and special events.</p>
                  </div>

                  <div className="flex items-center gap-2 mb-4">
                    <input type="checkbox" id="edit_allow_instant_park_vp" checked={editForm.allow_instant_park}
                           onChange={(e) => setEditForm(prev => ({ ...prev, allow_instant_park: e.target.checked }))}
                           className="w-4 h-4 rounded text-[#1D4ED8] focus:ring-[#1D4ED8]" />
                    <label htmlFor="edit_allow_instant_park_vp" className="text-xs font-semibold text-gray-600 uppercase cursor-pointer">
                      Allow Instant Park for this hotel's events
                    </label>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Contact Person Name</label>
                    <input ref={el => { if (hotelFieldRefs.current) hotelFieldRefs.current.contact_person_name = el; }} 
                      type="text"
                      value={editForm.contact_person_name}
                      onChange={(e) => { setEditForm({ ...editForm, contact_person_name: e.target.value}); if (editErrors.contact_person_name) setEditErrors(prev => ({ ...prev, contact_person_name: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${editErrors.contact_person_name ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`}
                    />
{ editErrors.contact_person_name && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.contact_person_name}</p> }
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Phone</label>
                      <input ref={el => { if (hotelFieldRefs.current) hotelFieldRefs.current.contact_person_phone = el; }} 
                        type="text"
                        value={editForm.contact_person_phone}
                        onChange={(e) => { setEditForm({ ...editForm, contact_person_phone: e.target.value}); if (editErrors.contact_person_phone) setEditErrors(prev => ({ ...prev, contact_person_phone: undefined })); }}
                        className={`w-full px-4 py-2 rounded-xl border ${editErrors.contact_person_phone ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`}
                      />
{ editErrors.contact_person_phone && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.contact_person_phone}</p> }
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Email</label>
                      <input ref={el => { if (hotelFieldRefs.current) hotelFieldRefs.current.contact_person_email = el; }} 
                        type="email"
                        value={editForm.contact_person_email}
                        onChange={(e) => { setEditForm({ ...editForm, contact_person_email: e.target.value}); if (editErrors.contact_person_email) setEditErrors(prev => ({ ...prev, contact_person_email: undefined })); }}
                        className={`w-full px-4 py-2 rounded-xl border ${editErrors.contact_person_email ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`}
                      />
{ editErrors.contact_person_email && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.contact_person_email}</p> }
                    </div>
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">
                        Gates
                      </label>
                    </div>
                    <div className="space-y-2 mb-2">
                      {editForm.gates.map((g, i) => (
                        <div key={i} className="flex gap-2 items-center">
                          <input
                            type="text"
                            placeholder="Gate name"
                            value={g}
                            onChange={(e) => {
                              const gates = [...editForm.gates];
                              gates[i] = e.target.value;
                              setEditForm({ ...editForm, gates });
                            }}
                            className="flex-1 px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:border-[#1D4ED8] text-sm"
                          />
                          <button type="button"
                            onClick={() => {
                              if (editForm.gates.length > 1) {
                                setEditForm({ ...editForm, gates: editForm.gates.filter((_, k) => k !== i) });
                              }
                            }}
                            className="text-red-400 hover:text-red-600 font-bold text-lg leading-none px-1">
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    <button type="button"
                      onClick={() => setEditForm({ ...editForm, gates: [...editForm.gates, ""] })}
                      className="w-full py-2 rounded-xl border border-dashed border-[#1D4ED8] text-[#1D4ED8] text-sm font-semibold hover:bg-blue-50 transition">
                      + Add Gate
                    </button>
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">
                        Parking Zones
                      </label>
                      <span className={`text-xs font-bold ${totalSlots > editForm.total_valet_slots ? "text-red-500" : "text-emerald-600"}`}>
                        {totalSlots} / {editForm.total_valet_slots || "—"} slots
                      </span>
                    </div>
                    <div className="space-y-2 mb-2">
                      {editForm.zones.map((z, i) => (
                        <div key={i} className="flex gap-2 items-center">
                          <input
                            type="text"
                            placeholder="Zone name (e.g. A)"
                            value={z.name}
                            onChange={(e) => {
                              const zones = [...editForm.zones];
                              zones[i] = { ...zones[i], name: e.target.value };
                              setEditForm({ ...editForm, zones });
                            }}
                            className="flex-1 px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:border-[#1D4ED8] text-sm"
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
                            className="w-20 px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:border-[#1D4ED8] text-sm text-center"
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
                      className="w-full py-2 rounded-xl border border-dashed border-[#1D4ED8] text-[#1D4ED8] text-sm font-semibold hover:bg-blue-50 transition">
                      + Add Zone
                    </button>
                  </div>


                  <p className="text-xs text-gray-400 mb-2"><span className="text-red-500">*</span> Required fields</p>
                  <div className="pt-4 flex gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setEditHotelOpen(false); setEditErrors({});
                        const h = hotel;
                        setEditForm({
                          name: h.name || "",
                          address: h.address || "",
                          city: h.city || "",
                          state: h.state || "",
                          total_valet_slots: h.total_valet_slots || "",
                          contact_person_name: h.contact_person_name || "",
                          contact_person_phone: h.contact_person_phone || "",
                          contact_person_email: h.contact_person_email || "",
                          zones: h.zones || [{ name: "A", slots: h.total_valet_slots || 50 }],
                          gates: h.gates || ["Main Gate"]
                        });
                      }}
                      className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-semibold hover:bg-gray-50 transition"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="flex-1 px-4 py-2.5 rounded-xl bg-[#1D4ED8] text-white font-semibold hover:bg-[#1E40AF] transition"
                    >
                      Save Changes
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}

        {activeTab === "drivers" && (<>
          {/* Assigned Drivers */}
          <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden">
            <div className="p-6 border-b border-gray-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-[#1D4ED8]"><Users className="w-4 h-4" /></div>
                <h3 className="font-heading text-lg font-bold text-[#0F2044]">Assigned Drivers</h3>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    value={driverSearch}
                    onChange={e => setDriverSearch(e.target.value)}
                    placeholder="Search drivers..."
                    className="pl-9 pr-3 py-1.5 w-full sm:w-64 rounded-xl border border-gray-200 text-sm outline-none focus:border-[#1D4ED8]"
                  />
                </div>
                <div className="relative">
                  <button onClick={() => setShowAddDriver(!showAddDriver)} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#1D4ED8] text-white text-xs font-bold hover:bg-[#1E40AF] transition-all">
                    <Plus className="w-3.5 h-3.5" /> Add Driver
                  </button>
                  {showAddDriver && (
                    <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-2xl border border-gray-100 z-10 p-2 animate-in fade-in zoom-in duration-200">
                      <div className="text-[10px] uppercase font-bold text-gray-400 p-2 border-b border-gray-50 mb-1">Select Driver</div>
                      <div className="max-h-60 overflow-y-auto" ref={driverModalRef}>
                        {unassignedDrivers.length === 0 ? (
                          <div className="text-xs text-gray-400 p-4 text-center italic">No unassigned drivers</div>
                        ) : (
                          unassignedDrivers.map(d => (
                            <button key={d.id} onClick={() => assignDriver(d.id)} className="w-full text-left px-3 py-2 rounded-lg hover:bg-blue-50 text-xs font-bold text-gray-700 transition-colors">
                              {d.name} <span className="text-gray-400 font-normal ml-1">({d.employee_id})</span>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="overflow-x-auto w-full max-w-full">
              {filteredDrivers.length === 0 ? (
                <div className="p-12 text-center text-gray-400 italic text-sm">No drivers found.</div>
              ) : (
                <div className="overflow-x-auto w-full max-w-full">
                  <table className="w-full text-sm min-w-[600px]">
                    <thead className="bg-gray-50 text-gray-400 uppercase text-[10px] font-bold">
                      <tr>
                        <th className="text-left px-6 py-3">Name</th>
                        <th className="text-left px-6 py-3">Contact</th>
                        <th className="text-left px-6 py-3">ID</th>
                        <th className="text-right px-6 py-3">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {paginatedDrivers.map(d => (
                        <tr key={d.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4 font-bold text-[#0F2044]">{d.name}</td>
                          <td className="px-6 py-4 text-gray-500 text-xs">{d.phone}</td>
                          <td className="px-6 py-4 font-mono text-xs text-gray-400">{d.employee_id}</td>
                          <td className="px-6 py-4 text-right">
                            <button onClick={() => removeDriver(d.id)} className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"><Trash2 className="w-4 h-4" /></button>
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
        </>
        )}

        {activeTab === "supervisors" && (<>
          {/* Assigned Supervisors */}
          <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden">
            <div className="p-6 border-b border-gray-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600"><ShieldCheck className="w-4 h-4" /></div>
                <h3 className="font-heading text-lg font-bold text-[#0F2044]">Assigned Supervisors</h3>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    value={supervisorSearch}
                    onChange={e => setSupervisorSearch(e.target.value)}
                    placeholder="Search supervisors..."
                    className="pl-9 pr-3 py-1.5 w-full sm:w-64 rounded-xl border border-gray-200 text-sm outline-none focus:border-[#1D4ED8]"
                  />
                </div>
                <div className="relative">
                  <button onClick={() => setShowAddSupervisor(!showAddSupervisor)} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition-all">
                    <Plus className="w-3.5 h-3.5" /> Add Supervisor
                  </button>
                  {showAddSupervisor && (
                    <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-2xl border border-gray-100 z-10 p-2 animate-in fade-in zoom-in duration-200">
                      <div className="text-[10px] uppercase font-bold text-gray-400 p-2 border-b border-gray-50 mb-1">Select Supervisor</div>
                      <div className="max-h-60 overflow-y-auto" ref={supervisorModalRef}>
                        {unassignedSupervisors.length === 0 ? (
                          <div className="text-xs text-gray-400 p-4 text-center italic">No unassigned supervisors</div>
                        ) : (
                          unassignedSupervisors.map(s => (
                            <button key={s.id} onClick={() => assignSupervisor(s.id)} className="w-full text-left px-3 py-2 rounded-lg hover:bg-indigo-50 text-xs font-bold text-gray-700 transition-colors">
                              {s.name} <span className="text-gray-400 font-normal ml-1">({s.email})</span>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="overflow-x-auto w-full max-w-full">
              {filteredSupervisors.length === 0 ? (
                <div className="p-12 text-center text-gray-400 italic text-sm">No supervisors found.</div>
              ) : (
                <div className="overflow-x-auto w-full max-w-full">
                  <table className="w-full text-sm min-w-[600px]">
                    <thead className="bg-gray-50 text-gray-400 uppercase text-[10px] font-bold">
                      <tr>
                        <th className="text-left px-6 py-3">Name</th>
                        <th className="text-left px-6 py-3">Email</th>
                        <th className="text-right px-6 py-3">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {paginatedSupervisors.map(s => (
                        <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4 font-bold text-[#0F2044]">{s.name}</td>
                          <td className="px-6 py-4 text-gray-500 text-xs">{s.email}</td>
                          <td className="px-6 py-4 text-right">
                            <button onClick={() => removeSupervisor(s.id)} className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"><Trash2 className="w-4 h-4" /></button>
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
        </>
        )}

        {activeTab === "events" && (<>
          {/* Events Section */}
          <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden">
            <div className="p-6 border-b border-gray-50">
              <div className="flex items-center justify-between w-full mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600"><Calendar className="w-4 h-4" /></div>
                  <h3 className="font-heading text-lg font-bold text-[#0F2044]">Events</h3>
                </div>
                {eventTypeTab === "special" && (
                  <button
                    onClick={() => setShowEventModal(true)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-[#1D4ED8] text-white text-xs font-bold rounded-xl hover:bg-[#1e40af] transition-all shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" /> Create Special Event
                  </button>
                )}
              </div>

              <div className="flex items-center justify-between">
                <div className="flex bg-gray-100 p-1 rounded-xl">
                  <button
                    onClick={() => { setEventTypeTab("daily"); setDailyPage(1); }}
                    className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${eventTypeTab === "daily" ? "bg-white text-[#1A3C6E] shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                  >
                    Daily Events
                  </button>
                  <button
                    onClick={() => { setEventTypeTab("special"); setSpecialPage(1); }}
                    className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${eventTypeTab === "special" ? "bg-white text-[#1A3C6E] shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                  >
                    Special Events
                  </button>
                </div>

                <div className="flex gap-2">
                  {["active", "closed", "all"].map(opt => {
                    const currentFilter = eventTypeTab === "daily" ? dailyFilter : specialFilter;
                    const isActive = currentFilter === opt;
                    return (
                      <button
                        key={opt}
                        onClick={() => {
                          if (eventTypeTab === "daily") {
                            setDailyFilter(opt);
                            setDailyPage(1);
                          } else {
                            setSpecialFilter(opt);
                            setSpecialPage(1);
                          }
                        }}
                        className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-full border transition-all ${isActive ? "bg-[#1A3C6E] text-white border-[#1A3C6E]" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"}`}
                      >
                        {opt}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto min-h-[300px]">
              {loadingEvents ? (
                <div className="p-6">
                  <SkeletonTable rows={5} columns={4} />
                </div>
              ) : (eventTypeTab === "daily" ? dailyEvents : specialEvents).length === 0 ? (
                <div className="p-12 text-center text-gray-400 italic text-sm">No events found.</div>
              ) : (
                <>
                  <div className="overflow-x-auto w-full max-w-full">
                    <table className="w-full text-sm min-w-[600px]">
                      <thead className="bg-gray-50 text-gray-400 uppercase text-[10px] font-bold">
                        <tr>
                          <th className="text-left px-6 py-3">Event Name</th>
                          <th className="text-left px-6 py-3">Type</th>
                          <th className="text-left px-6 py-3">Date</th>
                          <th className="text-right px-6 py-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {(eventTypeTab === "daily" ? dailyEvents : specialEvents).map(e => (
                          <tr key={e.id} onClick={() => nav(`/superadmin/events/${e.id}`)}
                            className="hover:bg-gray-50 cursor-pointer transition-colors group">
                            <td className="px-6 py-4">
                              <div className="font-bold text-[#0F2044] group-hover:text-[#1D4ED8] transition-colors">{e.name}</div>
                            </td>
                            <td className="px-6 py-4">
                              {e.event_type === "hotel_daily" ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-tighter bg-sky-50 text-[#0284C7] border border-[#0284C7]/20">Auto Daily</span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-tighter bg-purple-100 text-purple-700 border border-purple-200">Special</span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-gray-500 text-xs tabular-nums">{e.date}</td>
                            <td className="px-6 py-4 text-right">
                              <div className="flex items-center justify-end gap-3">
                                {e.event_type === "hotel_special" && (
                                  <button
                                    onClick={(evt) => {
                                      evt.stopPropagation();
                                      handleShowQr(e);
                                    }}
                                    className="p-1.5 rounded-lg text-gray-400 hover:text-[#1D4ED8] hover:bg-blue-50 transition"
                                    title="Show QR Code"
                                  >
                                    <QrCode className="w-4 h-4" />
                                  </button>
                                )}
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${e.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
                                  {e.status}
                                </span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  <div className="p-4 border-t border-gray-100 flex items-center justify-between">
                    <span className="text-xs text-gray-500">
                      Showing {(eventTypeTab === "daily" ? dailyPage : specialPage) * 20 - 19} - {Math.min((eventTypeTab === "daily" ? dailyPage : specialPage) * 20, eventTypeTab === "daily" ? dailyTotal : specialTotal)} of {eventTypeTab === "daily" ? dailyTotal : specialTotal}
                    </span>
                    <div className="flex gap-2">
                      <button
                        disabled={(eventTypeTab === "daily" ? dailyPage : specialPage) === 1}
                        onClick={() => eventTypeTab === "daily" ? setDailyPage(p => p - 1) : setSpecialPage(p => p - 1)}
                        className="px-3 py-1.5 text-xs font-bold border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Prev
                      </button>
                      <button
                        disabled={(eventTypeTab === "daily" ? dailyPage : specialPage) * 20 >= (eventTypeTab === "daily" ? dailyTotal : specialTotal)}
                        onClick={() => eventTypeTab === "daily" ? setDailyPage(p => p + 1) : setSpecialPage(p => p + 1)}
                        className="px-3 py-1.5 text-xs font-bold border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </>
              )}



            </div>
          </div>
        </>
        )}

        {activeTab === "cars" && (
          <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-gray-100">
              <h2 className="font-heading text-lg font-bold text-[#0F2044]">Cars Registry
                <span className="ml-2 text-sm font-normal text-gray-400">({filteredHotelCars.length} unique plates)</span>
              </h2>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={hotelCarSearch} onChange={e => { setHotelCarSearch(e.target.value); setHotelCarsPage(1); }}
                  placeholder="Search plate or make…"
                  className="pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-[#1A3C6E] w-full sm:w-64" />
              </div>
            </div>
            {loadingHotelCars ? (
              <div className="py-16 flex justify-center"><div className="w-8 h-8 border-4 border-[#1A3C6E] border-t-transparent rounded-full animate-spin" /></div>
            ) : (
              <div className="overflow-x-auto w-full max-w-full">
                <table className="w-full text-sm min-w-[600px]">
                  <thead className="bg-gray-50 text-gray-500 uppercase text-xs tracking-wider">
                    <tr>
                      <th className="text-left px-6 py-3">Plate</th>
                      <th className="text-left px-6 py-3">Make</th>
                      <th className="text-left px-6 py-3">Color</th>
                      <th className="text-left px-6 py-3">Visits</th>
                      <th className="text-left px-6 py-3">Last Event</th>
                      <th className="text-left px-6 py-3">Last Seen</th>
                      <th className="text-left px-6 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedHotelCars.length === 0 && (
                      <tr><td colSpan="7" className="text-center text-gray-400 py-12">No cars found</td></tr>
                    )}
                    {paginatedHotelCars.map(c => (
                      <tr key={c.plate} onClick={() => nav(`/superadmin/cars/${c.plate}`)}
                        className="border-t border-gray-100 hover:bg-[#F4F6FA] cursor-pointer transition-colors">
                        <td className="px-6 py-4 font-mono font-black text-[#0F2044]">{c.plate}</td>
                        <td className="px-6 py-4 text-gray-600">{c.make || "—"}</td>
                        <td className="px-6 py-4 text-gray-600">{c.color || "—"}</td>
                        <td className="px-6 py-4 font-bold text-[#1A3C6E]">{c.total_visits}</td>
                        <td className="px-6 py-4 text-gray-500">{c.last_event_name || "—"}</td>
                        <td className="px-6 py-4 text-gray-500 text-xs">{fmtDate(c.last_seen)}</td>
                        <td className="px-6 py-4">
                          {c.has_active
                            ? <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-700">Active</span>
                            : <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-gray-100 text-gray-600">Completed</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {filteredHotelCars.length > 10 && (
              <div className="px-4 sm:px-6 py-4 border-t border-gray-100 flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-gray-400">Showing {Math.min((hotelCarsPage - 1) * 10 + 1, filteredHotelCars.length)}–{Math.min(hotelCarsPage * 10, filteredHotelCars.length)} of {filteredHotelCars.length}</span>
                <div className="flex flex-wrap items-center gap-2">
                  <button disabled={hotelCarsPage === 1} onClick={() => setHotelCarsPage(p => p - 1)} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Prev</button>
                  <span className="px-3 py-1.5 rounded-lg bg-[#0F2044] text-white text-sm font-bold">{hotelCarsPage}</span>
                  <button disabled={hotelCarsPage * 10 >= filteredHotelCars.length} onClick={() => setHotelCarsPage(p => p + 1)} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Next</button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "queue" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100">
                <h3 className="font-heading text-sm font-bold text-[#0F2044]">Active Events</h3>
              </div>
              {hotelLiveEvents.length === 0 ? (
                <div className="py-12 text-center text-gray-400 text-sm">No active events right now</div>
              ) : (
                hotelLiveEvents.map(e => (
                  <div key={e.id} onClick={() => setSelectedHotelLiveEvent(e)}
                    className={`px-6 py-4 border-b border-gray-50 cursor-pointer transition-colors ${selectedHotelLiveEvent?.id === e.id ? "bg-[#0F2044] text-white" : "hover:bg-[#F4F6FA]"
                      }`}>
                    <div className={`font-semibold text-sm ${selectedHotelLiveEvent?.id === e.id ? "text-white" : "text-[#0F2044]"}`}>{e.name}</div>
                    <div className={`text-xs mt-0.5 ${selectedHotelLiveEvent?.id === e.id ? "text-white/60" : "text-gray-400"}`}>{e.venue} · {e.date}</div>
                  </div>
                ))
              )}
            </div>
            <div className="lg:col-span-2 bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden">
              {!selectedHotelLiveEvent ? (
                <div className="py-24 text-center text-gray-400 text-sm">Select an active event to see its live queue</div>
              ) : (
                <>
                  <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="font-heading text-lg font-bold text-[#0F2044]">{selectedHotelLiveEvent.name}</h3>
                    <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live
                    </span>
                  </div>
                  {loadingHotelQueue ? (
                    <div className="py-16 flex justify-center"><div className="w-8 h-8 border-4 border-[#1A3C6E] border-t-transparent rounded-full animate-spin" /></div>
                  ) : hotelLiveQueue.length === 0 ? (
                    <div className="py-16 text-center text-gray-400 text-sm">No cars in queue</div>
                  ) : (
                    <div className="overflow-x-auto w-full max-w-full">
                      <table className="w-full text-sm min-w-[600px]">
                        <thead className="bg-gray-50 text-gray-500 uppercase text-xs tracking-wider">
                          <tr>
                            <th className="text-left px-6 py-3">Plate</th>
                            <th className="text-left px-6 py-3">Guest</th>
                            <th className="text-left px-6 py-3">Status</th>
                            <th className="text-left px-6 py-3">Driver</th>
                            <th className="text-left px-6 py-3">Zone / Slot</th>
                            <th className="text-left px-6 py-3">Time in Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {hotelLiveQueue.map(c => (
                            <tr key={c.car_id} className="border-t border-gray-100 hover:bg-[#F4F6FA] transition-colors">
                              <td className="px-6 py-4 font-mono font-black text-[#0F2044]">{c.car_number || "—"}</td>
                              <td className="px-6 py-4 text-[#0F2044] font-medium">{c.guest_name || "—"}</td>
                              <td className="px-6 py-4">
                                <StatusBadge status={c.status} />
                              </td>
                              <td className="px-6 py-4 text-gray-600">
                                {(() => {
                                  if (c.status === "RETRIEVAL_REQUESTED" || c.status === "BEING_FETCHED") {
                                    return c.retrieval_driver_name || c.parked_driver_name || "—";
                                  } else if (c.status === "PARKED") {
                                    return c.parked_driver_name || "—";
                                  } else {
                                    return c.check_in_driver_name || "—";
                                  }
                                })()}
                              </td>
                              <td className="px-6 py-4 font-mono text-gray-500">{c.zone && c.slot ? `${c.zone} / ${c.slot}` : "—"}</td>
                              <td className="px-6 py-4 text-gray-500">{c.minutes_in_current_status != null ? `${c.minutes_in_current_status} min` : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {activeTab === "incidents" && (
          <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-gray-100">
              <h2 className="font-heading text-lg font-bold text-[#0F2044]">Incidents
                <span className="ml-2 text-sm font-normal text-gray-400">({filteredHotelIncidents.length} total)</span>
              </h2>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={hotelIncidentSearch} onChange={e => { setHotelIncidentSearch(e.target.value); setHotelIncidentsPage(1); }}
                  placeholder="Search incidents…"
                  className="pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-[#1A3C6E] w-full sm:w-64" />
              </div>
            </div>
            {loadingHotelIncidents ? (
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
                      <th className="text-left px-6 py-3">Driver</th>
                      <th className="text-left px-6 py-3">Date</th>
                      <th className="text-left px-6 py-3">Status</th>
                      <th className="text-left px-6 py-3">Remark</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedHotelIncidents.length === 0 && (
                      <tr><td colSpan="8" className="text-center text-gray-400 py-12">No incidents found</td></tr>
                    )}
                    {paginatedHotelIncidents.map((inc, i) => (
                      <tr key={inc.id || i} className="border-t border-gray-100 hover:bg-[#F4F6FA] transition-colors">
                        <td className="px-6 py-4 font-semibold text-[#1A3C6E]">{inc.event_name || "—"}</td>
                        <td className="px-6 py-4 text-gray-600 max-w-xs truncate">{inc.description || "—"}</td>
                        <td className="px-6 py-4">
                          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-gray-100 text-gray-700">
                            {(inc.incident_type || "UNKNOWN").replace(/_/g, " ").replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.substr(1).toLowerCase())}
                          </span>
                        </td>
                        <td className="px-6 py-4 font-mono text-gray-500">{inc.plate || "—"}</td>
                        <td className="px-6 py-4 text-gray-500">{inc.driver_name || "—"}</td>
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
            {filteredHotelIncidents.length > 10 && (
              <div className="px-4 sm:px-6 py-4 border-t border-gray-100 flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-gray-400">Showing {Math.min((hotelIncidentsPage - 1) * 10 + 1, filteredHotelIncidents.length)}–{Math.min(hotelIncidentsPage * 10, filteredHotelIncidents.length)} of {filteredHotelIncidents.length}</span>
                <div className="flex flex-wrap items-center gap-2">
                  <button disabled={hotelIncidentsPage === 1} onClick={() => setHotelIncidentsPage(p => p - 1)} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Prev</button>
                  <span className="px-3 py-1.5 rounded-lg bg-[#0F2044] text-white text-sm font-bold">{hotelIncidentsPage}</span>
                  <button disabled={hotelIncidentsPage * 10 >= filteredHotelIncidents.length} onClick={() => setHotelIncidentsPage(p => p + 1)} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Next</button>
                </div>
              </div>
            )}
          </div>
        )}

      </div>

      {/* QR Code Modal */}
      {/* {qrModalEvent && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-8 bg-black/50 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 mb-8">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <div>
                <h3 className="font-heading text-xl font-bold text-[#0F2044]">Special Event QR</h3>
                <p className="text-xs text-gray-500 font-medium">{qrModalEvent.name}</p>
              </div>
              <button onClick={() => { setQrModalEvent(null); setQrToken(null); }} className="p-2 hover:bg-white rounded-xl text-gray-400 hover:text-gray-600 transition-all shadow-sm">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-8 flex flex-col items-center text-center">
              <div className="bg-blue-50 p-6 rounded-[2.5rem] mb-6 shadow-inner">
                {qrToken ? (
                  <QRCodeSVG
                    id="special-event-qr"
                    value={`${window.location.origin}/pre-register/event/${qrToken}`}
                    size={200}
                    fgColor="#1D4ED8"
                    bgColor="#EFF6FF"
                    level="H"
                  />
                ) : (
                  <div className="w-[200px] h-[200px] flex items-center justify-center text-blue-400">
                    <Clock className="w-8 h-8 animate-spin" />
                  </div>
                )}
              </div>

              <p className="text-sm text-gray-500 mb-8 max-w-[280px]">
                Guests can scan this QR to pre-register their vehicles for this special event.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
                <button
                  onClick={() => {
                    const url = `${window.location.origin}/pre-register/event/${qrToken}`;
                    navigator.clipboard.writeText(url);
                    toast.success("Registration link copied!");
                  }}
                  disabled={!qrToken}
                  className="flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-gray-50 text-gray-700 font-bold text-sm hover:bg-gray-100 transition-all disabled:opacity-50"
                >
                  <Copy className="w-4 h-4" /> Copy Link
                </button>

                <button
                  onClick={() => {
                    const svg = document.getElementById("special-event-qr");
                    const svgData = new XMLSerializer().serializeToString(svg);
                    const canvas = document.createElement("canvas");
                    const ctx = canvas.getContext("2d");
                    const img = new Image();
                    img.onload = () => {
                      canvas.width = 1000;
                      canvas.height = 1000;
                      ctx.fillStyle = "#EFF6FF";
                      ctx.fillRect(0, 0, 1000, 1000);
                      ctx.drawImage(img, 100, 100, 800, 800);
                      const a = document.createElement("a");
                      a.download = `QR-${qrModalEvent.name.replace(/\s+/g, '-')}.png`;
                      a.href = canvas.toDataURL("image/png");
                      a.click();
                    };
                    img.src = "data:image/svg+xml;base64," + btoa(svgData);
                  }}
                  disabled={!qrToken}
                  className="flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-[#1D4ED8] text-white font-bold text-sm hover:bg-[#1E40AF] shadow-lg shadow-blue-200 transition-all disabled:opacity-50"
                >
                  <Download className="w-4 h-4" /> Download
                </button>
              </div>
            </div>
          </div>
        </div>
      )} */}

      {showEventModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-8 bg-black/50 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200 mb-8">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h3 className="font-heading text-xl font-bold text-[#0F2044]">Create Special Event</h3>
              <button onClick={() => setShowEventModal(false)} className="p-2 hover:bg-gray-100 rounded-xl text-gray-400 transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateEvent} className="p-6 space-y-4 overflow-y-auto max-h-[70vh]" ref={createEventModalRef}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Event Name <span className="text-red-500">*</span></label>
                  <input ref={el => { if (eventFieldRefs.current) eventFieldRefs.current.name = el; }}  type="text" value={eventForm.name}
                    onChange={e => { setEventForm(prev => ({ ...prev, name: e.target.value})); if (eventErrors.name) setEventErrors(prev => ({ ...prev, name: undefined })); }}
                    className={`w-full px-4 py-2 rounded-xl border ${eventErrors.name ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`}
                    placeholder="e.g. New Year Gala" />
{ eventErrors.name && <p className="text-[11px] text-red-500 mt-1 font-medium">* {eventErrors.name}</p> }
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Host Name (Optional)</label>
                  <input type="text" value={eventForm.host_name}
                    onChange={e => { setEventForm(prev => ({ ...prev, host_name: e.target.value})); if (eventErrors.host_name) setEventErrors(prev => ({ ...prev, host_name: undefined })); }}
                    className={`w-full px-4 py-2 rounded-xl border ${eventErrors.host_name ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`}
                    placeholder="e.g. John Doe" />
{ eventErrors.host_name && <p className="text-[11px] text-red-500 mt-1 font-medium">* {eventErrors.host_name}</p> }
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Host Email (Optional)</label>
                  <input ref={el => { if (eventFieldRefs.current) eventFieldRefs.current.host_email = el; }}  type="email" value={eventForm.host_email}
                    onChange={e => { setEventForm(prev => ({ ...prev, host_email: e.target.value})); if (eventErrors.host_email) setEventErrors(prev => ({ ...prev, host_email: undefined })); }}
                    className={`w-full px-4 py-2 rounded-xl border ${eventErrors.host_email ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`}
                    placeholder="e.g. host@example.com" />
{ eventErrors.host_email && <p className="text-[11px] text-red-500 mt-1 font-medium">* {eventErrors.host_email}</p> }
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Start Date <span className="text-red-500">*</span></label>
                  <input ref={el => { if (eventFieldRefs.current) eventFieldRefs.current.date = el; }}  type="date" value={eventForm.date}
                    onChange={e => { setEventForm(prev => ({ ...prev, date: e.target.value})); if (eventErrors.date) setEventErrors(prev => ({ ...prev, date: undefined })); }}
                    className={`w-full px-4 py-2 rounded-xl border ${eventErrors.date ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`} />
{ eventErrors.date && <p className="text-[11px] text-red-500 mt-1 font-medium">* {eventErrors.date}</p> }
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">End Date <span className="text-red-500">*</span></label>
                  <input ref={el => { if (eventFieldRefs.current) eventFieldRefs.current.end_date = el; }}  type="date" value={eventForm.end_date}
                    onChange={e => { setEventForm(prev => ({ ...prev, end_date: e.target.value})); if (eventErrors.end_date) setEventErrors(prev => ({ ...prev, end_date: undefined })); }}
                    className={`w-full px-4 py-2 rounded-xl border ${eventErrors.end_date ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`} />
{ eventErrors.end_date && <p className="text-[11px] text-red-500 mt-1 font-medium">* {eventErrors.end_date}</p> }
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Start Time <span className="text-red-500">*</span></label>
                  <input ref={el => { if (eventFieldRefs.current) eventFieldRefs.current.start_time = el; }}  type="time" value={eventForm.start_time}
                    onChange={e => { setEventForm(prev => ({ ...prev, start_time: e.target.value})); if (eventErrors.start_time) setEventErrors(prev => ({ ...prev, start_time: undefined })); }}
                    className={`w-full px-4 py-2 rounded-xl border ${eventErrors.start_time ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`} />
{ eventErrors.start_time && <p className="text-[11px] text-red-500 mt-1 font-medium">* {eventErrors.start_time}</p> }
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">End Time <span className="text-red-500">*</span></label>
                  <input ref={el => { if (eventFieldRefs.current) eventFieldRefs.current.end_time = el; }}  type="time" value={eventForm.end_time}
                    onChange={e => { setEventForm(prev => ({ ...prev, end_time: e.target.value})); if (eventErrors.end_time) setEventErrors(prev => ({ ...prev, end_time: undefined })); }}
                    className={`w-full px-4 py-2 rounded-xl border ${eventErrors.end_time ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`} />
{ eventErrors.end_time && <p className="text-[11px] text-red-500 mt-1 font-medium">* {eventErrors.end_time}</p> }
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Max Cars <span className="text-red-500">*</span></label>
                  <input ref={el => { if (eventFieldRefs.current) eventFieldRefs.current.max_cars = el; }}  type="number" min="1" value={eventForm.max_cars}
                    onChange={e => { setEventForm(prev => ({ ...prev, max_cars: parseInt(e.target.value) || 0})); if (eventErrors.max_cars) setEventErrors(prev => ({ ...prev, max_cars: undefined })); }}
                    className={`w-full px-4 py-2 rounded-xl border ${eventErrors.max_cars ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`} />
{ eventErrors.max_cars && <p className="text-[11px] text-red-500 mt-1 font-medium">* {eventErrors.max_cars}</p> }
                </div>
                <div className="flex items-center gap-2 mt-4 sm:col-span-2">
                  <input type="checkbox" id="allow_instant_park_event_vp" checked={eventForm.allow_instant_park}
                         onChange={(e) => setEventForm(prev => ({ ...prev, allow_instant_park: e.target.checked }))}
                         className="w-4 h-4 text-[#1D4ED8] bg-gray-100 border-gray-300 rounded focus:ring-[#1D4ED8]" />
                  <label htmlFor="allow_instant_park_event_vp" className="text-xs font-semibold text-gray-600 uppercase cursor-pointer">
                    Allow Instant Park for this event
                  </label>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Gates</label>
                  <div className="space-y-2">
                    {eventForm.gates.map((gate, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={gate}
                          onChange={e => {
                            const newGates = [...eventForm.gates];
                            newGates[i] = e.target.value;
                            setEventForm({ ...eventForm, gates: newGates });
                          }}
                          placeholder="Gate name"
                          className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]"
                        />
                        {eventForm.gates.length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              const newGates = eventForm.gates.filter((_, idx) => idx !== i);
                              setEventForm({ ...eventForm, gates: newGates });
                            }}
                            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setEventForm({ ...eventForm, gates: [...eventForm.gates, ""] })}
                      className="text-xs font-bold text-[#1D4ED8] hover:text-[#1e40af] flex items-center gap-1 mt-1"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Gate
                    </button>
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Venue</label>
                  <input ref={el => { if (eventFieldRefs.current) eventFieldRefs.current.venue = el; }}  type="text" value={eventForm.venue}
                    onChange={e => { setEventForm(prev => ({ ...prev, venue: e.target.value})); if (eventErrors.venue) setEventErrors(prev => ({ ...prev, venue: undefined })); }}
                    className={`w-full px-4 py-2 rounded-xl border ${eventErrors.venue ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`}
                    placeholder="Venue name or location" />
{ eventErrors.venue && <p className="text-[11px] text-red-500 mt-1 font-medium">* {eventErrors.venue}</p> }
                </div>
              </div>

              {/* Zones */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Parking Zones</label>
                  <span className={`text-xs font-bold ${totalEventSlots > eventForm.max_cars ? "text-red-500" : "text-emerald-600"}`}>
                    {totalEventSlots} / {eventForm.max_cars} slots
                  </span>
                </div>
                {eventForm.zones.map((z, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <input  type="text" placeholder="Zone name (e.g. A)"
                      value={z.name}
                      onChange={e => {
                        const zones = [...eventForm.zones];
                        zones[i] = { ...zones[i], name: e.target.value };
                        setEventForm(prev => ({ ...prev, zones }));
                      }}
                      className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]" />
                    <input type="number" placeholder="Slots" min="1"
                      value={z.slots}
                      onChange={e => {
                        const zones = [...eventForm.zones];
                        zones[i] = { ...zones[i], slots: parseInt(e.target.value) || 0 };
                        setEventForm(prev => ({ ...prev, zones }));
                      }}
                      className="w-24 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]" />
                    {eventForm.zones.length > 1 && (
                      <button type="button" onClick={() => setEventForm(prev => ({ ...prev, zones: prev.zones.filter((_, k) => k !== i) }))}
                        className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
                {totalEventSlots > eventForm.max_cars && (
                  <p className="text-xs text-red-500 font-medium mt-1">⚠ Total zone slots exceed max cars. Please reduce.</p>
                )}
                <button type="button"
                  onClick={() => setEventForm(prev => ({ ...prev, zones: [...prev.zones, { name: "", slots: 10 }] }))}
                  className="mt-1 text-xs font-bold text-[#1D4ED8] hover:underline">
                  + Add Zone
                </button>
              </div>


              <p className="text-xs text-gray-400 mb-2"><span className="text-red-500">*</span> Required fields</p>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowEventModal(false)}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-600 hover:bg-gray-50 transition">
                  Cancel
                </button>
                <button type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-[#1D4ED8] text-white text-sm font-bold hover:bg-[#1e40af] transition shadow-sm">
                  Create Event
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </SuperLayout>
  );
}
