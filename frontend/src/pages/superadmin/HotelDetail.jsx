import { useEffect, useState, useMemo, useRef } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import SuperLayout from "@/components/layout/SuperLayout";
import { State, City } from "country-state-city";
import { api } from "@/lib/api";
import { fmtDate, fmtDateTimeFull } from "@/lib/time";
import { toast } from "sonner";
import { ArrowLeft, Building2, MapPin, Phone, Mail, Clock, Car, Star, Calendar, Edit2, Save, X, Camera, Plus, Trash2, User, Users, ShieldCheck, CheckCircle2, Check, QrCode, Copy, Download, Upload, Search, ChevronDown, Radio, AlertTriangle, CheckCircle } from "lucide-react";
import EmptyState from "@/components/ui/EmptyState";
import SkeletonTable from "@/components/ui/SkeletonTable";
import { QRCodeSVG } from "qrcode.react";

const generateTempPassword = () => Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10).toUpperCase() + "1!";
import * as XLSX from "xlsx";
import StatusBadge from "@/components/ui/StatusBadge";

import { useScrollToFirstError } from "../../hooks/useScrollToFirstError";

export default function HotelDetail() {
  const { hid } = useParams();
  const nav = useNavigate();
  const hotelFieldRefs = useRef({});
  const scrollToFirstHotelError = useScrollToFirstError(["name", "address", "state", "city", "contact_person_name", "contact_person_phone", "contact_person_email", "total_valet_slots", "provider_email", "provider_password", "provider_confirm_password"], hotelFieldRefs);

  const eventFieldRefs = useRef({});
  const scrollToFirstEventError = useScrollToFirstError(["name", "host_email", "date", "end_date", "venue", "start_time", "end_time", "max_cars"], eventFieldRefs);

  const driverFieldRefs = useRef({});
  const scrollToFirstDriverError = useScrollToFirstError(["name", "phone", "pin", "email", "gender", "pan_number", "bank_account_number", "bank_ifsc", "driving_license_number", "aadhar_number", "licensePhoto", "drvAadharPhoto"], driverFieldRefs);

  const supervisorFieldRefs = useRef({});
  const scrollToFirstSupervisorError = useScrollToFirstError(["name", "phone", "email", "gender", "password", "confirmPassword", "pan_number", "bank_account_number", "bank_ifsc", "aadhar_number", "supAadharPhoto"], supervisorFieldRefs);
  const [hotel, setHotel] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showHotelQRModal, setShowHotelQRModal] = useState(false);

  // For assignments
  const [drivers, setDrivers] = useState([]);
  const [supervisors, setSupervisors] = useState([]);
  const [driverStatusFilter, setDriverStatusFilter] = useState("All");
  const [supervisorStatusFilter, setSupervisorStatusFilter] = useState("All");
  const [driverModal, setDriverModal] = useState(false);
  const [driverForm, setDriverForm] = useState({ name: "", phone: "", pin: "", email: "", gender: "", pan_number: "", bank_account_number: "", bank_ifsc: "", driving_license_number: "", aadhar_number: "", driver_photo: "", license_photo: "" });
  const [driverErrors, setDriverErrors] = useState({});
  const [savingDriver, setSavingDriver] = useState(false);
  const [driverPhotoPreview, setDriverPhotoPreview] = useState(null);
  const [licensePhotoPreview, setLicensePhotoPreview] = useState(null);
  const [aadharPhotoPreview, setAadharPhotoPreview] = useState(null);
  const [supervisorPhotoPreview, setSupervisorPhotoPreview] = useState(null);

  const [supervisorModal, setSupervisorModal] = useState(false);
  const [supervisorForm, setSupervisorForm] = useState({ name: "", email: "", phone: "", password: "", confirmPassword: "", gender: "", pan_number: "", bank_account_number: "", bank_ifsc: "", aadhar_number: "", supervisor_photo: "" });
  const [supervisorErrors, setSupervisorErrors] = useState({});
  const [savingSupervisor, setSavingSupervisor] = useState(false);
  const [supAadharPhotoPreview, setSupAadharPhotoPreview] = useState(null);
  const [showAddDriver, setShowAddDriver] = useState(false);
  const [showAddSupervisor, setShowAddSupervisor] = useState(false);

  // Filters
  const [driverSearch, setDriverSearch] = useState("");
  const [supervisorSearch, setSupervisorSearch] = useState("");
  const [activeTab, setActiveTab] = useState("info");

  const [driversPage, setDriversPage] = useState(1);
  const [supervisorsPage, setSupervisorsPage] = useState(1);

  useEffect(() => { setDriversPage(1); }, [driverSearch, driverStatusFilter]);
  useEffect(() => { setSupervisorsPage(1); }, [supervisorSearch, supervisorStatusFilter]);

  const [eventTypeTab, setEventTypeTab] = useState("daily");
  const [triggeringDailyJob, setTriggeringDailyJob] = useState(false);
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

  // Guest List
  const [guests, setGuests] = useState([]);
  const [loadingGuests, setLoadingGuests] = useState(false);
  const [guestSearch, setGuestSearch] = useState("");
  const [guestsPage, setGuestsPage] = useState(1);
  const fileInputRef = useRef(null);
  const [uploadingGuests, setUploadingGuests] = useState(false);
  const [guestUploadTarget, setGuestUploadTarget] = useState("daily"); // "daily" | event_id

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
    provider_email: "",
    provider_password: "",
    provider_confirm_password: "",
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

  useEffect(() => {
    if (!driverModal && !supervisorModal && !showEventModal && !qrModalEvent && !editHotelOpen && !showHotelQRModal) return;
    const handleEsc = (e) => {
      if (e.key === "Escape") {
        if (qrModalEvent) { setQrModalEvent(null); setQrToken(null); }
        else if (showEventModal) setShowEventModal(false);
        else if (editHotelOpen) setEditHotelOpen(false);
        else if (showHotelQRModal) setShowHotelQRModal(false);
        else if (driverModal) closeDriverModal();
        else if (supervisorModal) setSupervisorModal(false); setSupervisorErrors({});
      }
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [driverModal, supervisorModal, showEventModal, qrModalEvent, editHotelOpen]);

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
      const h = resHotel.data;

      // Safely fetch provider email — may fail for hotel_owner type hotels
      let providerEmail = "";
      try {
        if (h.provider_id) {
          const resProvider = await api.get(`/providers/${h.provider_id}`);
          providerEmail = resProvider.data.email || "";
        }
      } catch {
        // provider fetch failed — continue without it
      }

      // Initialize edit form
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
        provider_email: providerEmail,
        provider_password: "",
        provider_confirm_password: "",
        zones: h.zones || [{ name: "A", slots: h.total_valet_slots || 50 }],
        gates: h.gates || ["Main Gate"]
      });

      // Safely fetch drivers and supervisors
      try {
        if (h.provider_id) {
          const [resProvDrivers, resProvSups] = await Promise.all([
            api.get(`/drivers?provider_id=${h.provider_id}`),
            api.get(`/supervisors?provider_id=${h.provider_id}`)
          ]);
          setDrivers(resProvDrivers.data.filter(d => d.provider_id === h.provider_id));
          setSupervisors(resProvSups.data.filter(s => s.provider_id === h.provider_id));
        }
      } catch {
        setDrivers([]);
        setSupervisors([]);
      }

    } catch (err) {
      toast.error("Failed to load hotel details");
    } finally {
      setLoading(false);
    }
  };

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
    if (activeTab === "guest_list" && guests.length === 0) {
      setLoadingGuests(true);
      api.get(`/hotels/${hid}/guest-list`)
        .then(r => setGuests(r.data))
        .catch(() => toast.error("Failed to load guest list"))
        .finally(() => setLoadingGuests(false));
    }
  }, [activeTab, dailyEvents, specialEvents, hid]);

  const handleGuestFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".xlsx")) {
      toast.error("Please upload a valid .xlsx file");
      return;
    }

    setUploadingGuests(true);
    const fd = new FormData();
    fd.append("file", file);
    if (guestUploadTarget !== "daily") {
      fd.append("event_id", guestUploadTarget);
    }

    try {
      const { data } = await api.post(`/hotels/${hid}/guest-list/upload`, fd);
      toast.success(`Successfully uploaded and sent SMS to ${data.inserted} guests`);
      const { data: list } = await api.get(`/hotels/${hid}/guest-list`);
      setGuests(list);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Upload failed");
    } finally {
      setUploadingGuests(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const downloadGuestTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([{ Name: "", Contact: "", "Expected Arrival": "" }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Guests");
    XLSX.writeFile(wb, "GuestList_Template.xlsx");
  };

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
        if (!iso) return "-";
        try {
          return fmtDate(iso);
        } catch {
          return "-";
        }
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
    if (!editForm.contact_person_phone?.trim()) errs.contact_person_phone = "Contact person phone is required";
    else if (!/^\d{10}$/.test(editForm.contact_person_phone.replace(/\D/g, ""))) errs.contact_person_phone = "Contact person phone must be exactly 10 digits";
    if (editForm.contact_person_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editForm.contact_person_email.trim())) errs.contact_person_email = "Please enter a valid contact email address";
    if (!editForm.total_valet_slots || parseInt(editForm.total_valet_slots) < 1) errs.total_valet_slots = "Total valet slots must be at least 1";
    if (!editForm.provider_email?.trim()) errs.provider_email = "Login email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editForm.provider_email.trim())) errs.provider_email = "Please enter a valid login email address";
    if (editForm.provider_password) {
      if (editForm.provider_password.length < 8) errs.provider_password = "Password must be at least 8 characters";
      else if (editForm.provider_password !== editForm.provider_confirm_password) errs.provider_confirm_password = "Passwords do not match";
    }
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
      const providerPayload = {
        name: editForm.name,
        address: editForm.address,
        city: editForm.city,
        state: editForm.state,
        email: editForm.provider_email.trim().toLowerCase(),
        ...(editForm.provider_password ? { password: editForm.provider_password } : {})
      };

      await Promise.all([
        api.patch(`/hotels/${hid}`, body),
        api.patch(`/providers/${hotel.provider_id}`, providerPayload)
      ]);
      toast.success("Hotel updated successfully");
      setEditHotelOpen(false);
      setEditForm(prev => ({ ...prev, provider_password: "", provider_confirm_password: "" }));
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
    return drivers.filter(d => {
      const matchQ = !driverSearch || d.name?.toLowerCase().includes(driverSearch.toLowerCase()) || d.employee_id?.toLowerCase().includes(driverSearch.toLowerCase());
      const matchStatus = driverStatusFilter === "All" || (driverStatusFilter === "Active" ? d.is_active : !d.is_active);
      return matchQ && matchStatus;
    });
  }, [drivers, driverSearch, driverStatusFilter]);

  const filteredGuests = useMemo(() => {
    return guests.filter(g =>
      !guestSearch ||
      g.name?.toLowerCase().includes(guestSearch.toLowerCase()) ||
      g.contact?.toLowerCase().includes(guestSearch.toLowerCase())
    );
  }, [guests, guestSearch]);
  const paginatedGuests = filteredGuests.slice((guestsPage - 1) * 10, guestsPage * 10);

  const filteredSupervisors = useMemo(() => {
    return supervisors.filter(s => {
      const matchQ = !supervisorSearch || s.name?.toLowerCase().includes(supervisorSearch.toLowerCase()) || s.email?.toLowerCase().includes(supervisorSearch.toLowerCase());
      const matchStatus = supervisorStatusFilter === "All" || (supervisorStatusFilter === "Active" ? s.is_active : !s.is_active);
      return matchQ && matchStatus;
    });
  }, [supervisors, supervisorSearch, supervisorStatusFilter]);

  const paginatedDrivers = filteredDrivers.slice((driversPage - 1) * 10, driversPage * 10);
  const paginatedSupervisors = filteredSupervisors.slice((supervisorsPage - 1) * 10, supervisorsPage * 10);


  const handleTriggerDailyEvent = async () => {
    if (!window.confirm(`Run the daily event job for ${hotel?.name}? This creates today's event if missing and carries forward any stuck cars from yesterday.`)) return;
    setTriggeringDailyJob(true);
    try {
      await api.post(`/superadmin/hotels/${hid}/trigger-daily-event`);
      toast.success("Daily event processed for this hotel");
      fetchEvents("hotel_daily", dailyFilter, dailyPage);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to run daily event job");
    } finally {
      setTriggeringDailyJob(false);
    }
  };

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
    fetchEvents("hotel_daily", dailyFilter, dailyPage);
  }, [dailyFilter, dailyPage]);

  useEffect(() => {
    fetchEvents("hotel_special", specialFilter, specialPage);
  }, [specialFilter, specialPage]);



  const handleDriverPhoto = (e) => {
    const file = e.target.files[0];
    if (file) {
      setDriverForm({ ...driverForm, driver_photo_file: file });
      setDriverPhotoPreview(URL.createObjectURL(file));
    }
  };
  const handleLicensePhoto = (e) => {
    const file = e.target.files[0];
    if (file) {
      setDriverForm({ ...driverForm, license_photo_file: file });
      setLicensePhotoPreview(URL.createObjectURL(file));
    }
  };
  const handleAadharPhoto = (e) => {
    const file = e.target.files[0];
    if (file) {
      setDriverForm({ ...driverForm, aadhar_photo_file: file });
      setAadharPhotoPreview(URL.createObjectURL(file));
    }
  };
  const handleSupAadharPhoto = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSupervisorForm({ ...supervisorForm, aadhar_photo_file: file });
      setSupAadharPhotoPreview(URL.createObjectURL(file));
    }
  };
  const closeDriverModal = () => {
    setDriverModal(false); setDriverErrors({});
    setDriverForm({ name: "", phone: "", pin: "", email: "", gender: "", pan_number: "", bank_account_number: "", bank_ifsc: "", driving_license_number: "", aadhar_number: "", driver_photo: "", license_photo: "" });
    setDriverPhotoPreview(null);
    setLicensePhotoPreview(null);
    setAadharPhotoPreview(null);
  };
    const validateDriver = () => {
    const errs = {};
    if (!driverForm.name?.trim()) errs.name = "Name is required";
    if (!driverForm.phone?.trim()) errs.phone = "Phone is required";
    else if (!/^\d{10}$/.test(driverForm.phone.replace(/\D/g, ""))) errs.phone = "Phone must be exactly 10 digits";
    if (!driverForm.pin || driverForm.pin.length !== 4) errs.pin = "PIN must be exactly 4 digits";
    else if (!/^\d{4}$/.test(driverForm.pin)) errs.pin = "PIN must contain digits only";
    if (!driverForm.email?.trim()) errs.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(driverForm.email.trim())) errs.email = "Please enter a valid email address";
    if (!driverForm.gender) errs.gender = "Please select gender";
    if (driverForm.pan_number?.trim() && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(driverForm.pan_number.trim().toUpperCase())) errs.pan_number = "Invalid PAN format. Expected: ABCDE1234F";
    if (driverForm.bank_account_number?.trim() && !/^\d{9,18}$/.test(driverForm.bank_account_number.trim())) errs.bank_account_number = "Bank account number must be 9–18 digits";
    if (driverForm.bank_ifsc?.trim() && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(driverForm.bank_ifsc.trim().toUpperCase())) errs.bank_ifsc = "Invalid IFSC format. Expected: ABCD0123456";
    if (!driverForm.driving_license_number?.trim()) errs.driving_license_number = "Driving License Number is required";
    else if (!/^[A-Z0-9]{10,16}$/.test(driverForm.driving_license_number.trim().toUpperCase())) errs.driving_license_number = "Invalid driving license number. Must be 10–16 alphanumeric characters";
    if (!driverForm.aadhar_number?.trim()) errs.aadhar_number = "Aadhar Number is required";
    else if (!/^\d{12}$/.test(driverForm.aadhar_number.trim())) errs.aadhar_number = "Aadhar number must be exactly 12 digits";

    if (!driverForm.license_photo_file && !licensePhotoPreview) errs.licensePhoto = "Driving License Photo is required";
    if (!driverForm.aadhar_photo_file && !aadharPhotoPreview) errs.drvAadharPhoto = "Aadhar Photo is required";
    return errs;
  };

  const handleAddDriver = async (e) => {
    e.preventDefault();
    const errs = validateDriver();
    setDriverErrors(errs);
    if (Object.keys(errs).length > 0) {
      scrollToFirstDriverError(errs);
      return;
    }

    setSavingDriver(true);
    try {
      let dUrl = "";
      if (driverForm.driver_photo_file) {
        const fd = new FormData(); fd.append("file", driverForm.driver_photo_file); fd.append("folder", "drivers");
        const { data } = await api.post("/upload", fd); dUrl = data.url;
      }
      let lUrl = "";
      if (driverForm.license_photo_file) {
        const fd = new FormData(); fd.append("file", driverForm.license_photo_file); fd.append("folder", "licenses");
        const { data } = await api.post("/upload", fd); lUrl = data.url;
      }
      let aUrl = "";
      if (driverForm.aadhar_photo_file) {
        const fd = new FormData(); fd.append("file", driverForm.aadhar_photo_file); fd.append("folder", "aadhar_photos");
        const { data } = await api.post("/upload", fd); aUrl = data.url;
      }
      const payload = {
        provider_id: hotel.provider_id,
        name: driverForm.name, phone: driverForm.phone, pin: driverForm.pin, email: driverForm.email, gender: driverForm.gender,
        pan_number: driverForm.pan_number.trim(), bank_account_number: driverForm.bank_account_number.trim(), bank_ifsc: driverForm.bank_ifsc.trim().toUpperCase(),
        driving_license_number: driverForm.driving_license_number.trim().toUpperCase(), driver_photo: dUrl || null, driving_license_photo: lUrl || null,
        aadhar_number: driverForm.aadhar_number.trim(), aadhar_photo: aUrl || null
      };
      await api.post("/drivers", payload);
      toast.success("Driver added successfully!");
      closeDriverModal();
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to add driver");
    } finally {
      setSavingDriver(false);
    }
  };

    const validateSupervisor = () => {
    const errs = {};
    if (!supervisorForm.name?.trim()) errs.name = "Name is required";
    if (!supervisorForm.phone?.trim()) errs.phone = "Phone is required";
    else if (!/^\d{10}$/.test(supervisorForm.phone.replace(/\D/g, ""))) errs.phone = "Phone must be exactly 10 digits";
    if (!supervisorForm.email?.trim()) errs.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supervisorForm.email.trim())) errs.email = "Please enter a valid email address";
    // if (!supervisorForm.password?.trim()) errs.password = "Password is required";
    // else if (supervisorForm.password.length < 8) errs.password = "Password must be at least 8 characters";
    // else if (supervisorForm.password !== supervisorForm.confirmPassword) errs.confirmPassword = "Passwords do not match";
    if (!supervisorForm.gender) errs.gender = "Please select gender";
    if (supervisorForm.pan_number?.trim() && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(supervisorForm.pan_number.trim().toUpperCase())) errs.pan_number = "Invalid PAN format. Expected: ABCDE1234F";
    if (supervisorForm.bank_account_number?.trim() && !/^\d{9,18}$/.test(supervisorForm.bank_account_number.trim())) errs.bank_account_number = "Bank account number must be 9–18 digits";
    if (supervisorForm.bank_ifsc?.trim() && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(supervisorForm.bank_ifsc.trim().toUpperCase())) errs.bank_ifsc = "Invalid IFSC format. Expected: ABCD0123456";
    if (!supervisorForm.aadhar_number?.trim()) errs.aadhar_number = "Aadhar Number is required";
    else if (!/^\d{12}$/.test(supervisorForm.aadhar_number.trim())) errs.aadhar_number = "Aadhar number must be exactly 12 digits";

    if (!supervisorForm.aadhar_photo_file && !supAadharPhotoPreview) errs.supAadharPhoto = "Aadhar Photo is required";
    return errs;
  };

  const handleAddSupervisor = async (e) => {
    e.preventDefault();
    const errs = validateSupervisor();
    setSupervisorErrors(errs);
    if (Object.keys(errs).length > 0) {
      scrollToFirstSupervisorError(errs);
      return;
    }

    setSavingSupervisor(true);
    try {
      let supAadharUrl = null;
      if (supervisorForm.aadhar_photo_file) {
        const fd = new FormData(); fd.append("file", supervisorForm.aadhar_photo_file); fd.append("folder", "aadhar_photos");
        const { data } = await api.post("/upload", fd); supAadharUrl = data.url;
      }
      let supervisorPhotoUrl = null;
      if (supervisorForm.supervisor_photo_file) {
        const fd = new FormData(); fd.append("file", supervisorForm.supervisor_photo_file); fd.append("folder", "supervisors");
        const { data } = await api.post("/upload", fd); supervisorPhotoUrl = data.url;
      }
      const payload = {
        provider_id: hotel.provider_id,
        name: supervisorForm.name, email: supervisorForm.email, phone: supervisorForm.phone, password: generateTempPassword(), gender: supervisorForm.gender,
        pan_number: supervisorForm.pan_number.trim(), bank_account_number: supervisorForm.bank_account_number.trim(), bank_ifsc: supervisorForm.bank_ifsc.trim().toUpperCase(),
        aadhar_number: supervisorForm.aadhar_number.trim(), aadhar_photo: supAadharUrl || null,
        supervisor_photo: supervisorPhotoUrl || null
      };
      await api.post("/supervisors", payload);
      toast.success("Supervisor added successfully!");
      setSupervisorForm({ name: "", email: "", phone: "", password: "", confirmPassword: "", gender: "", pan_number: "", bank_account_number: "", bank_ifsc: "", aadhar_number: "", aadhar_photo_file: null, supervisor_photo: "", supervisor_photo_file: null });
      setSupAadharPhotoPreview(null);
      setSupervisorPhotoPreview(null);
      setSupervisorModal(false); setSupervisorErrors({});
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to add supervisor");
    } finally {
      setSavingSupervisor(false);
    }
  };

  const handleDeactivateSupervisor = async (sid, isActive) => {
    if (!window.confirm(`Are you sure you want to ${isActive ? "deactivate" : "reactivate"} this supervisor?`)) return;
    try {
      await api.patch(`/supervisors/${sid}`, { is_active: !isActive });
      toast.success(`Supervisor ${isActive ? "deactivated" : "reactivated"}`);
      loadData();
    } catch { toast.error("Failed to update supervisor"); }
  };



  const totalSlots = useMemo(() =>
    editForm.zones.reduce((sum, z) => sum + (parseInt(z.slots) || 0), 0),
    [editForm.zones]);

  if (loading) return (
    <SuperLayout title="Hotel Detail">
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="w-10 h-10 rounded-full border-4 border-[#1A3C6E] border-t-transparent animate-spin" />
        <p className="text-gray-400 text-sm font-medium">Loading...</p>
      </div>

      {/* Hotel QR Modal */}
      {showHotelQRModal && hotel.hotel_qr_token && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm" onClick={() => setShowHotelQRModal(false)}>
          <div className="bg-white rounded-3xl p-8 flex flex-col items-center gap-4 max-w-sm w-full shadow-2xl relative" onClick={e => e.stopPropagation()}>
            <div className="text-center mb-2">
              <h3 className="font-heading text-[#0F2044] text-xl font-bold">Hotel QR Code</h3>
              <p className="text-xs text-gray-500 font-medium">{hotel.name}</p>
            </div>
            <div className="bg-white p-2 rounded-xl shadow-sm border border-gray-100">
              <QRCodeSVG className="hotel-qr-svg-modal" value={`${window.location.origin}/hotel-register/${hotel.hotel_qr_token}`} size={200} />
            </div>
            <div className="flex gap-3 mt-2 w-full">
              <button
                onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/hotel-register/${hotel.hotel_qr_token}`); toast.success("Link copied!"); }}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                Copy Link
              </button>
              <button
                onClick={() => {
                  const canvas = document.createElement("canvas");
                  const size = 800;
                  canvas.width = size;
                  canvas.height = size;
                  const ctx = canvas.getContext("2d");
                  ctx.fillStyle = "#EFF6FF";
                  ctx.fillRect(0, 0, size, size);
                  const svg = document.querySelector(".hotel-qr-svg-modal");
                  if (!svg) return;
                  const svgData = new XMLSerializer().serializeToString(svg);
                  const img = new Image();
                  img.onload = () => {
                    ctx.drawImage(img, 40, 40, size - 80, size - 80);
                    const a = document.createElement("a");
                    a.download = `${hotel.name}-valet-qr.png`;
                    a.href = canvas.toDataURL("image/png");
                    a.click();
                  };
                  img.src = "data:image/svg+xml;base64," + btoa(svgData);
                }}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[#0F2044] text-white text-sm font-semibold hover:bg-[#1a3c6e]"
              >
                <Download className="w-4 h-4" /> Save
              </button>
            </div>
            <button onClick={() => setShowHotelQRModal(false)} className="text-xs text-gray-400 hover:text-gray-600 absolute top-4 right-4">Close</button>
          </div>
        </div>
      )}

    </SuperLayout>
  );
  if (!hotel) return <SuperLayout title="Hotel Detail"><div className="p-8 text-center text-gray-400">Hotel not found</div></SuperLayout>;

  return (
    <SuperLayout title="Hotel Detail">
      <Link to="/superadmin/hotels"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-[#1D4ED8] hover:text-[#1E40AF] mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Hotels
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
                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${(hotel?.provider_is_verified && hotel?.is_active) ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/30" : "bg-red-500/20 text-red-300 border border-red-400/30"}`}>
                    {(hotel?.provider_is_verified && hotel?.is_active) ? "Active" : "Inactive"}
                  </span>
                  {hotel?.provider_is_verified ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
                      <CheckCircle className="w-3 h-3" /> Verified
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium">
                      <AlertTriangle className="w-3 h-3" /> Unverified
                    </span>
                  )}
                </div>
                <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mt-0.5">Hotel Profile & Operations</p>

                <div className="mt-4 pt-4 border-t border-white/10 flex gap-2 flex-wrap">
                  <div onClick={() => setActiveTab("events")} className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 flex flex-col items-center gap-1 cursor-pointer hover:bg-white/15 hover:border-amber-400/40 hover:scale-[1.03] transition-all">
                    <div className="flex items-center gap-1 text-amber-400">
                      <Calendar className="w-3 h-3" />
                      <div className="text-[8px] uppercase font-bold text-white/40 tracking-wider">Events</div>
                    </div>
                    <div className="text-lg font-black text-white">{detail?.stats?.total_events ?? "—"}</div>
                  </div>
                  <div onClick={() => setActiveTab("cars")} className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 flex flex-col items-center gap-1 cursor-pointer hover:bg-white/15 hover:border-amber-400/40 hover:scale-[1.03] transition-all">
                    <div className="flex items-center gap-1 text-amber-400">
                      <Car className="w-3 h-3" />
                      <div className="text-[8px] uppercase font-bold text-white/40 tracking-wider">Cars Served</div>
                    </div>
                    <div className="text-lg font-black text-white">{detail?.stats?.total_cars_served ?? "—"}</div>
                  </div>
                  <div onClick={() => setActiveTab("drivers")} className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 flex flex-col items-center gap-1 cursor-pointer hover:bg-white/15 hover:border-amber-400/40 hover:scale-[1.03] transition-all">
                    <div className="flex items-center gap-1 text-amber-400">
                      <Users className="w-3 h-3" />
                      <div className="text-[8px] uppercase font-bold text-white/40 tracking-wider">Drivers</div>
                    </div>
                    <div className="text-lg font-black text-white">{drivers.length}</div>
                  </div>
                  <div onClick={() => setActiveTab("supervisors")} className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 flex flex-col items-center gap-1 cursor-pointer hover:bg-white/15 hover:border-amber-400/40 hover:scale-[1.03] transition-all">
                    <div className="flex items-center gap-1 text-amber-400">
                      <ShieldCheck className="w-3 h-3" />
                      <div className="text-[8px] uppercase font-bold text-white/40 tracking-wider">Supervisors</div>
                    </div>
                    <div className="text-lg font-black text-white">{supervisors.length}</div>
                  </div>
                  <div onClick={() => setActiveTab("incidents")} className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 flex flex-col items-center gap-1 cursor-pointer hover:bg-white/15 hover:border-amber-400/40 hover:scale-[1.03] transition-all">
                    <div className="flex items-center gap-1 text-amber-400">
                      <AlertTriangle className="w-3 h-3" />
                      <div className="text-[8px] uppercase font-bold text-white/40 tracking-wider">Incidents</div>
                    </div>
                    <div className="text-lg font-black text-white">{detail?.stats?.incidents ?? "—"}</div>
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 flex flex-col items-center gap-1">
                    <div className="flex items-center gap-1 text-amber-400">
                      <Star className="w-3 h-3" />
                      <div className="text-[8px] uppercase font-bold text-white/40 tracking-wider">Platform Rating</div>
                    </div>
                    <div className="text-lg font-black text-white">{detail?.stats?.platform_avg_rating ? `${detail.stats.platform_avg_rating}/5` : "—"}</div>
                  </div>

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
                className={`px-3 py-2 sm:px-4 sm:py-2 text-sm rounded-xl font-semibold transition border ${(hotel?.provider_is_verified && hotel?.is_active)
                  ? "border-red-400 bg-red-500/20 text-red-100 hover:bg-red-500/40"
                  : "border-emerald-300 bg-emerald-500 text-white hover:bg-emerald-600"
                  }`}
              >
                {(hotel?.provider_is_verified && hotel?.is_active) ? "Inactive" : "Active"}
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
            // { id: "guest_list", label: "Guest List", icon: Users },
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

                  <div className="col-span-1 md:col-span-2 flex items-center gap-2 mb-2">
                    <input type="checkbox" id="edit_allow_instant_park" checked={editForm.allow_instant_park}
                           onChange={(e) => setEditForm(prev => ({ ...prev, allow_instant_park: e.target.checked }))}
                           className="w-4 h-4 rounded text-[#1D4ED8] focus:ring-[#1D4ED8]" />
                    <label htmlFor="edit_allow_instant_park" className="text-xs font-semibold text-gray-600 uppercase cursor-pointer">
                      Allow Instant Park for this hotel's events
                    </label>
                  </div>

                  <div className="col-span-1 md:col-span-2 pt-6 pb-2 border-t border-gray-100">
                    <h3 className="text-sm font-bold text-[#0F2044] uppercase tracking-wider">Login Credentials</h3>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                      Login Email<span className="text-red-500"> *</span>
                    </label>
                    <input ref={el => { if (hotelFieldRefs.current) hotelFieldRefs.current.provider_email = el; }} 
                      type="email"
                      value={editForm.provider_email}
                      onChange={(e) => { setEditForm({ ...editForm, provider_email: e.target.value}); if (editErrors.provider_email) setEditErrors(prev => ({ ...prev, provider_email: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${editErrors.provider_email ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`}
                    />
{ editErrors.provider_email && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.provider_email}</p> }
                    <p className="text-xs text-gray-400 mt-1">This email is used to log in to the app</p>
                  </div>
                  <div></div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                      New Password (leave blank to keep current)
                    </label>
                    <input ref={el => { if (hotelFieldRefs.current) hotelFieldRefs.current.provider_password = el; }} 
                      type="password"
                      value={editForm.provider_password}
                      onChange={(e) => { setEditForm({ ...editForm, provider_password: e.target.value}); if (editErrors.provider_password) setEditErrors(prev => ({ ...prev, provider_password: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${editErrors.provider_password ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`}
                    />
{ editErrors.provider_password && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.provider_password}</p> }
                  </div>
                  {editForm.provider_password && (
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                        Confirm Password<span className="text-red-500"> *</span>
                      </label>
                      <input ref={el => { if (hotelFieldRefs.current) hotelFieldRefs.current.provider_confirm_password = el; }} 
                        type="password"
                        value={editForm.provider_confirm_password}
                        onChange={(e) => { setEditForm({ ...editForm, provider_confirm_password: e.target.value}); if (editErrors.provider_confirm_password) setEditErrors(prev => ({ ...prev, provider_confirm_password: undefined })); }}
                        className={`w-full px-4 py-2 rounded-xl border ${editErrors.provider_confirm_password ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]`}
                      />
{ editErrors.provider_confirm_password && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.provider_confirm_password}</p> }
                    </div>
                  )}
                  <div className="col-span-1 md:col-span-2 pt-6 pb-2 border-t border-gray-100">
                    <h3 className="text-sm font-bold text-[#0F2044] uppercase tracking-wider">Contact Person Details</h3>
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
                        setEditHotelOpen(false);
                        const h = hotel;
                        setEditForm({
                          name: h.name || "",
                          address: h.address || "",
                          city: h.city || "",
                          state: h.state || "",
                          total_valet_slots: h.total_valet_slots || "",
                          gate_timer_minutes: h.gate_timer_minutes || "",
                          contact_person_name: h.contact_person_name || "",
                          contact_person_phone: h.contact_person_phone || "",
                          contact_person_email: h.contact_person_email || "",
                          provider_email: editForm.provider_email || "",
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
                <h3 className="font-heading text-lg font-bold text-[#0F2044]">Drivers</h3>
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
                  <button onClick={() => setDriverModal(true)} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#1D4ED8] text-white text-xs font-bold hover:bg-[#1E40AF] transition-all">
                    <Plus className="w-3.5 h-3.5" /> Add Driver
                  </button>
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
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {paginatedDrivers.map(d => (
                        <tr key={d.id} onClick={() => nav(`/superadmin/drivers/${d.id}`)} className="hover:bg-gray-50 transition-colors cursor-pointer">
                          <td className="px-6 py-4 font-bold text-[#0F2044]">{d.name}</td>
                          <td className="px-6 py-4 text-gray-500 text-xs">{d.phone}</td>
                          <td className="px-6 py-4 font-mono text-xs text-gray-400">{d.employee_id}</td>
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
                <h3 className="font-heading text-lg font-bold text-[#0F2044]">Supervisors</h3>
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
                  <button onClick={() => setSupervisorModal(true)} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition-all">
                    <Plus className="w-3.5 h-3.5" /> Add Supervisor
                  </button>
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
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {paginatedSupervisors.map(s => (
                        <tr key={s.id} onClick={() => nav(`/superadmin/supervisors/${s.id}`)} className="hover:bg-gray-50 transition-colors cursor-pointer">
                          <td className="px-6 py-4 font-bold text-[#0F2044]">{s.name}</td>
                          <td className="px-6 py-4 text-gray-500 text-xs">{s.email}</td>
                          <td className="px-6 py-4 text-right">
                            <button onClick={(e) => {
                              e.stopPropagation();
                              handleDeactivateSupervisor(s.id, s.is_active !== false);
                            }} className={`p-2 rounded-lg transition-colors ${s.is_active !== false ? "text-red-600 hover:bg-red-50" : "text-green-600 hover:bg-green-50"}`}>
                              {s.is_active !== false ? "Deactivate" : "Reactivate"}
                            </button>
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
                {eventTypeTab === "daily" && (
                  <button
                    onClick={handleTriggerDailyEvent}
                    disabled={triggeringDailyJob}
                    className="flex items-center gap-1.5 px-4 py-2 bg-[#0F2044] text-white text-xs font-bold rounded-xl hover:bg-[#1a3660] transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Radio className="w-3.5 h-3.5" /> {triggeringDailyJob ? "Running…" : "Run Daily Event"}
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

        {/* {activeTab === "guest_list" && (
          <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden animate-in fade-in duration-300">
            <div className="p-4 sm:p-6 border-b border-gray-100">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#EFF6FF] text-[#1D4ED8] flex items-center justify-center shadow-inner">
                    <Users className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-[#0F2044]">Guest List</h2>
                    <p className="text-sm text-gray-500 font-medium">Manage pre-registered VIPs and guests</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                  <div className="relative flex-1 sm:min-w-[250px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search guests by name or phone..."
                      value={guestSearch}
                      onChange={(e) => setGuestSearch(e.target.value)}
                      className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#1D4ED8] focus:ring-1 focus:ring-[#1D4ED8] bg-gray-50/50"
                    />
                  </div>
                  <select
                    value={guestUploadTarget}
                    onChange={e => setGuestUploadTarget(e.target.value)}
                    className="px-3 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-700 bg-white focus:outline-none focus:border-[#1D4ED8]"
                  >
                    <option value="daily">Daily Valet</option>
                    {specialEvents.filter(e => e.status === "active").map(e => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                  <input type="file" ref={fileInputRef} accept=".xlsx" className="hidden" onChange={handleGuestFileUpload} />
                  <button onClick={downloadGuestTemplate} className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-700 bg-white hover:bg-gray-50 font-bold text-sm shadow-sm transition-all whitespace-nowrap">
                    <Download className="w-4 h-4" /> Template
                  </button>
                  <button onClick={() => fileInputRef.current?.click()} disabled={uploadingGuests} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0F2044] text-white font-bold text-sm hover:bg-[#1A3C6E] shadow-sm shadow-[#0F2044]/20 transition-all whitespace-nowrap disabled:opacity-50">
                    {uploadingGuests ? <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> : <Upload className="w-4 h-4" />}
                    Upload List
                  </button>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto min-h-[300px]">
              {loadingGuests ? (
                <div className="p-6">
                  <SkeletonTable rows={5} columns={5} />
                </div>
              ) : guests.length === 0 ? (
                <EmptyState icon={<Users className="w-8 h-8" />} title="No Guests Found" description={guestSearch ? "No guests match your search." : "Upload an Excel file to invite guests to pre-register."} />
              ) : (
                <div className="overflow-x-auto w-full max-w-full">
                  <table className="w-full text-sm min-w-[800px]">
                    <thead className="bg-gray-50 text-gray-400 uppercase text-[10px] font-bold tracking-wider">
                      <tr>
                        <th className="text-left px-6 py-4">Name</th>
                        <th className="text-left px-6 py-4">Contact</th>
                        <th className="text-left px-6 py-4">Expected Arrival</th>
                        <th className="text-left px-6 py-4">SMS Sent</th>
                        <th className="text-left px-6 py-4">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {paginatedGuests.map((g) => (
                        <tr key={g.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-6 py-4 font-bold text-[#0F2044]">{g.name}</td>
                          <td className="px-6 py-4 text-gray-500 font-medium">{g.contact || "—"}</td>
                          <td className="px-6 py-4 text-gray-500 font-medium">{g.expected_arrival || "—"}</td>
                          <td className="px-6 py-4">
                            {g.sms_sent ? (
                              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-green-50 text-green-700 border border-green-200/50 w-fit">
                                <CheckCircle2 className="w-3 h-3" /> Sent
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-gray-100 text-gray-600 border border-gray-200 w-fit">Pending</span>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            {g.pre_registered ? (
                              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200/50 w-fit">Registered</span>
                            ) : (
                              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-gray-50 text-gray-500 border border-gray-200 w-fit">Invited</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {filteredGuests.length > 10 && (
              <div className="px-6 py-4 border-t border-gray-100 flex flex-wrap gap-4 items-center justify-between bg-gray-50/30">
                <span className="text-xs font-medium text-gray-500">
                  Showing {Math.min((guestsPage - 1) * 10 + 1, filteredGuests.length)}–{Math.min(guestsPage * 10, filteredGuests.length)} of {filteredGuests.length}
                </span>
                <div className="flex items-center gap-2">
                  <button disabled={guestsPage === 1} onClick={() => setGuestsPage(p => p - 1)} className="px-4 py-2 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 hover:bg-white disabled:opacity-40 transition-colors shadow-sm bg-gray-50">Prev</button>
                  <span className="px-4 py-2 rounded-xl bg-[#0F2044] text-white text-xs font-bold shadow-md">{guestsPage}</span>
                  <button disabled={guestsPage * 10 >= filteredGuests.length} onClick={() => setGuestsPage(p => p + 1)} className="px-4 py-2 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 hover:bg-white disabled:opacity-40 transition-colors shadow-sm bg-gray-50">Next</button>
                </div>
              </div>
            )}
          </div>
        )} */}

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
                                  if (c.status === "RETRIEVAL_REQUESTED" || c.status === "ACCEPTED" || c.status === "BEING_FETCHED") {
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
                            <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${inc.status === "OPEN" ? "bg-red-100 text-red-700" :
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h3 className="font-heading text-xl font-bold text-[#0F2044]">Create Special Event</h3>
              <button onClick={() => setShowEventModal(false)} className="p-2 hover:bg-gray-100 rounded-xl text-gray-400 transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateEvent} className="p-6 space-y-4 overflow-y-auto max-h-[70vh]">
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
                  <input type="checkbox" id="allow_instant_park_event" checked={eventForm.allow_instant_park}
                         onChange={(e) => setEventForm(prev => ({ ...prev, allow_instant_park: e.target.checked }))}
                         className="w-4 h-4 text-[#1D4ED8] bg-gray-100 border-gray-300 rounded focus:ring-[#1D4ED8]" />
                  <label htmlFor="allow_instant_park_event" className="text-xs font-semibold text-gray-600 uppercase cursor-pointer">
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
                    <input type="text" placeholder="Zone name (e.g. A)"
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

      {driverModal && (
        <div id="modal-add-driver" className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-8 bg-black/50 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl flex flex-col mb-8">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
              <h3 className="font-heading text-xl font-bold text-[#0F2044]">Add Driver</h3>
              <button onClick={closeDriverModal} className="text-gray-400 hover:text-gray-600">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="px-6 py-4">
              <form onSubmit={handleAddDriver} className="space-y-4">
                <div className="flex flex-col items-center mb-4">
                  <div className="relative group">
                    <div
                      onClick={() => document.getElementById("driver-photo-input").click()}
                      className="w-20 h-20 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-[#1A3C6E] transition overflow-hidden"
                    >
                      {driverPhotoPreview ? (
                        <img src={driverPhotoPreview} alt="Driver"
                          className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-3xl">👤</span>
                      )}
                    </div>
                    {driverPhotoPreview && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDriverPhotoPreview(null);
                          setDriverForm(prev => ({ ...prev, driver_photo_file: null }));
                        }}
                        className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-400 hover:text-red-500 hover:border-red-200 transition-all z-10"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 mt-1">Driver Photo (optional)</span>
                  <input
                    id="driver-photo-input"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleDriverPhoto}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Name <span className="text-red-500">*</span></label>
                    <input ref={el => { if (driverFieldRefs.current) driverFieldRefs.current.name = el; }}  type="text" value={driverForm.name}
                      onChange={e => { setDriverForm({ ...driverForm, name: e.target.value}); if (driverErrors.name) setDriverErrors(prev => ({ ...prev, name: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${driverErrors.name ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`} />
{ driverErrors.name && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.name}</p> }
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Phone <span className="text-red-500">*</span></label>
                    <input ref={el => { if (driverFieldRefs.current) driverFieldRefs.current.phone = el; }}  type="tel" value={driverForm.phone} inputMode="numeric"
                      onChange={e => { setDriverForm({ ...driverForm, phone: e.target.value.replace(/\D/g, "").slice(0, 10)}); if (driverErrors.phone) setDriverErrors(prev => ({ ...prev, phone: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${driverErrors.phone ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E] font-mono`} />
{ driverErrors.phone && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.phone}</p> }
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">4-Digit PIN <span className="text-red-500">*</span></label>
                    <input ref={el => { if (driverFieldRefs.current) driverFieldRefs.current.pin = el; }}  type="text" value={driverForm.pin}
                      onChange={e => { setDriverForm({ ...driverForm, pin: e.target.value.replace(/\D/g, "").slice(0, 4)}); if (driverErrors.pin) setDriverErrors(prev => ({ ...prev, pin: undefined })); }}
                      placeholder="e.g. 1234"
                      className={`w-full px-4 py-2 rounded-xl border ${driverErrors.pin ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E] font-mono tracking-widest`} />
{ driverErrors.pin && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.pin}</p> }
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                      Email <span className="text-red-500">*</span>
                    </label>
                    <input ref={el => { if (driverFieldRefs.current) driverFieldRefs.current.email = el; }}  type="email" value={driverForm.email}
                      onChange={e => { setDriverForm({ ...driverForm, email: e.target.value}); if (driverErrors.email) setDriverErrors(prev => ({ ...prev, email: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${driverErrors.email ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`} />
{ driverErrors.email && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.email}</p> }
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Gender <span className="text-red-500">*</span></label>
                    <select ref={el => { if (driverFieldRefs.current) driverFieldRefs.current.gender = el; }}  value={driverForm.gender}
                      onChange={e => { setDriverForm({ ...driverForm, gender: e.target.value}); if (driverErrors.gender) setDriverErrors(prev => ({ ...prev, gender: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${driverErrors.gender ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`}>
                      <option value="" disabled>Select gender</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
{ driverErrors.gender && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.gender}</p> }
                  </div>
                  <div className="hidden sm:block"></div>
                </div>

                <div className="border-t border-gray-100 my-4" />
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">
                  Documents
                </p>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">PAN Card Number</label>
                    <input ref={el => { if (driverFieldRefs.current) driverFieldRefs.current.pan_number = el; }}  type="text" placeholder="ABCDE1234F" value={driverForm.pan_number}
                      onChange={e => { setDriverForm({ ...driverForm, pan_number: e.target.value.toUpperCase().slice(0, 10)}); if (driverErrors.pan_number) setDriverErrors(prev => ({ ...prev, pan_number: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${driverErrors.pan_number ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E] font-mono`} />
{ driverErrors.pan_number && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.pan_number}</p> }
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Bank Account Number</label>
                    <input ref={el => { if (driverFieldRefs.current) driverFieldRefs.current.bank_account_number = el; }}  type="text" value={driverForm.bank_account_number} inputMode="numeric"
                      onChange={e => { setDriverForm({ ...driverForm, bank_account_number: e.target.value.replace(/\D/g, "").slice(0, 18)}); if (driverErrors.bank_account_number) setDriverErrors(prev => ({ ...prev, bank_account_number: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${driverErrors.bank_account_number ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E] font-mono`} />
{ driverErrors.bank_account_number && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.bank_account_number}</p> }
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Bank IFSC Code</label>
                    <input ref={el => { if (driverFieldRefs.current) driverFieldRefs.current.bank_ifsc = el; }}  type="text" placeholder="SBIN0001234" value={driverForm.bank_ifsc}
                      onChange={e => { setDriverForm({ ...driverForm, bank_ifsc: e.target.value.toUpperCase().slice(0, 11)}); if (driverErrors.bank_ifsc) setDriverErrors(prev => ({ ...prev, bank_ifsc: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${driverErrors.bank_ifsc ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E] font-mono`} />
{ driverErrors.bank_ifsc && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.bank_ifsc}</p> }
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Driving License Number <span className="text-red-500">*</span></label>
                    <input ref={el => { if (driverFieldRefs.current) driverFieldRefs.current.driving_license_number = el; }}  type="text" value={driverForm.driving_license_number}
                      onChange={e => { setDriverForm({ ...driverForm, driving_license_number: e.target.value.toUpperCase().slice(0, 16)}); if (driverErrors.driving_license_number) setDriverErrors(prev => ({ ...prev, driving_license_number: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${driverErrors.driving_license_number ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E] font-mono`} />
{ driverErrors.driving_license_number && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.driving_license_number}</p> }
                  </div>
                </div>

                <div ref={el => { if (driverFieldRefs.current) driverFieldRefs.current.licensePhoto = el; }}  className="mb-4">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Driving License Photo <span className="text-red-500"> *</span></label>
                  <div className="relative group">
                    <div
                      onClick={() => document.getElementById("license-photo-input").click()}
                      className={`w-full border-2 border-dashed ${driverErrors.licensePhoto ? "border-red-400" : "border-gray-200"} rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer hover:border-[#1A3C6E] transition`}
                    >
                      {licensePhotoPreview ? (
                        <img src={licensePhotoPreview} alt="License"
                          className="h-24 w-full object-cover rounded-lg" />
                      ) : (
                        <>
                          <span className="text-2xl mb-1">📄</span>
                          <span className="text-xs text-gray-400">Click to upload license photo</span>
                        </>
                      )}
                    </div>
                    {licensePhotoPreview && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLicensePhotoPreview(null);
                          setDriverForm(prev => ({ ...prev, license_photo_file: null }));
                        }}
                        className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-400 hover:text-red-500 hover:border-red-200 transition-all z-10"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <input
                    id="license-photo-input"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleLicensePhoto}
                  />
                </div>
                  {driverErrors.licensePhoto && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.licensePhoto}</p>}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Aadhar Number <span className="text-red-500">*</span></label>
                    <input ref={el => { if (driverFieldRefs.current) driverFieldRefs.current.aadhar_number = el; }}  type="text" value={driverForm.aadhar_number} inputMode="numeric"
                      onChange={e => { setDriverForm({ ...driverForm, aadhar_number: e.target.value.replace(/\D/g, "").slice(0, 12)}); if (driverErrors.aadhar_number) setDriverErrors(prev => ({ ...prev, aadhar_number: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${driverErrors.aadhar_number ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E] font-mono`} />
{ driverErrors.aadhar_number && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.aadhar_number}</p> }
                  </div>
                  <div />
                </div>

                <div ref={el => { if (driverFieldRefs.current) driverFieldRefs.current.drvAadharPhoto = el; }}  className="mb-4">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Aadhar Photo <span className="text-red-500"> *</span></label>
                  <div className="relative group">
                    <div
                      onClick={() => document.getElementById("aadhar-photo-input").click()}
                      className={`w-full border-2 border-dashed ${driverErrors.drvAadharPhoto ? "border-red-400" : "border-gray-200"} rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer hover:border-[#1A3C6E] transition`}
                    >
                      {aadharPhotoPreview ? (
                        <img src={aadharPhotoPreview} alt="Aadhar"
                          className="h-24 w-full object-cover rounded-lg" />
                      ) : (
                        <>
                          <span className="text-2xl mb-1">📄</span>
                          <span className="text-xs text-gray-400">Click to upload aadhar photo</span>
                        </>
                      )}
                    </div>
                    {aadharPhotoPreview && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setAadharPhotoPreview(null);
                          setDriverForm(prev => ({ ...prev, aadhar_photo_file: null }));
                        }}
                        className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-400 hover:text-red-500 hover:border-red-200 transition-all z-10"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <input
                    id="aadhar-photo-input"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => { handleAadharPhoto(e); if (driverErrors.drvAadharPhoto) setDriverErrors(prev => ({ ...prev, drvAadharPhoto: undefined })); }}
                  />
                </div>
                {driverErrors.drvAadharPhoto && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.drvAadharPhoto}</p>}


                <p className="text-xs text-gray-400 mb-2"><span className="text-red-500">*</span> Required fields</p>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={closeDriverModal}
                    className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50">Cancel</button>
                  <button type="submit" disabled={savingDriver}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-[#1A3C6E] text-white font-semibold hover:bg-[#0F2044] disabled:opacity-60">
                    {savingDriver ? "Saving..." : "Add Driver"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {supervisorModal && (
        <div id="modal-add-supervisor" className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-8 bg-black/50 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl flex flex-col animate-in fade-in zoom-in duration-200 mb-8">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
              <h3 className="font-heading text-xl font-bold text-[#0F2044]">Add Supervisor</h3>
              <button onClick={() => setSupervisorModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="px-6 py-4">
              <form onSubmit={handleAddSupervisor} autoComplete="off" className="space-y-4">
                <div className="flex flex-col items-center mb-4">
                  <div className="relative group">
                    <div
                      onClick={() => document.getElementById("supervisor-photo-input").click()}
                      className="w-20 h-20 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-[#1A3C6E] transition overflow-hidden"
                    >
                      {supervisorPhotoPreview ? (
                        <img src={supervisorPhotoPreview} alt="Supervisor"
                          className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-3xl">👤</span>
                      )}
                    </div>
                    {supervisorPhotoPreview && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSupervisorPhotoPreview(null);
                          setSupervisorForm(prev => ({ ...prev, supervisor_photo_file: null }));
                        }}
                        className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-400 hover:text-red-500 hover:border-red-200 transition-all z-10"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 mt-1">Supervisor Photo (optional)</span>
                  <input
                    id="supervisor-photo-input"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files[0];
                      if (!file) return;
                      setSupervisorPhotoPreview(URL.createObjectURL(file));
                      setSupervisorForm(prev => ({ ...prev, supervisor_photo_file: file }));
                    }}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Full Name <span className="text-red-500">*</span></label>
                    <input ref={el => { if (supervisorFieldRefs.current) supervisorFieldRefs.current.name = el; }}  type="text" value={supervisorForm.name}
                      onChange={e => { setSupervisorForm({ ...supervisorForm, name: e.target.value}); if (supervisorErrors.name) setSupervisorErrors(prev => ({ ...prev, name: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${supervisorErrors.name ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`} />
{ supervisorErrors.name && <p className="text-[11px] text-red-500 mt-1 font-medium">* {supervisorErrors.name}</p> }
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Phone Number <span className="text-red-500">*</span></label>
                    <input ref={el => { if (supervisorFieldRefs.current) supervisorFieldRefs.current.phone = el; }}  type="tel" value={supervisorForm.phone} inputMode="numeric"
                      onChange={e => { setSupervisorForm({ ...supervisorForm, phone: e.target.value.replace(/\D/g, "").slice(0, 10)}); if (supervisorErrors.phone) setSupervisorErrors(prev => ({ ...prev, phone: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${supervisorErrors.phone ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E] font-mono`} />
{ supervisorErrors.phone && <p className="text-[11px] text-red-500 mt-1 font-medium">* {supervisorErrors.phone}</p> }
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Email <span className="text-red-500">*</span></label>
                    <input ref={el => { if (supervisorFieldRefs.current) supervisorFieldRefs.current.email = el; }}  type="email" value={supervisorForm.email}
                      name="new-supervisor-email" autoComplete="off"
                      onChange={e => { setSupervisorForm({ ...supervisorForm, email: e.target.value}); if (supervisorErrors.email) setSupervisorErrors(prev => ({ ...prev, email: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${supervisorErrors.email ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`} />
{ supervisorErrors.email && <p className="text-[11px] text-red-500 mt-1 font-medium">* {supervisorErrors.email}</p> }
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Gender <span className="text-red-500">*</span></label>
                    <select ref={el => { if (supervisorFieldRefs.current) supervisorFieldRefs.current.gender = el; }}  value={supervisorForm.gender}
                      onChange={e => { setSupervisorForm({ ...supervisorForm, gender: e.target.value}); if (supervisorErrors.gender) setSupervisorErrors(prev => ({ ...prev, gender: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${supervisorErrors.gender ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`}>
                      <option value="" disabled>Select gender</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
{ supervisorErrors.gender && <p className="text-[11px] text-red-500 mt-1 font-medium">* {supervisorErrors.gender}</p> }
                  </div>
                </div>
                {/* <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Password <span className="text-red-500">*</span></label>
                    <input ref={el => { if (supervisorFieldRefs.current) supervisorFieldRefs.current.password = el; }}  type="password" value={supervisorForm.password}
                      name="new-supervisor-password" autoComplete="new-password"
                      onChange={e => { setSupervisorForm({ ...supervisorForm, password: e.target.value}); if (supervisorErrors.password) setSupervisorErrors(prev => ({ ...prev, password: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${supervisorErrors.password ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`} />
{ supervisorErrors.password && <p className="text-[11px] text-red-500 mt-1 font-medium">* {supervisorErrors.password}</p> }
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Confirm <span className="text-red-500">*</span></label>
                    <input ref={el => { if (supervisorFieldRefs.current) supervisorFieldRefs.current.confirmPassword = el; }}  type="password" value={supervisorForm.confirmPassword}
                      name="new-supervisor-confirm-password" autoComplete="new-password"
                      onChange={e => { setSupervisorForm({ ...supervisorForm, confirmPassword: e.target.value}); if (supervisorErrors.confirmPassword) setSupervisorErrors(prev => ({ ...prev, confirmPassword: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${supervisorErrors.confirmPassword ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`} />
{ supervisorErrors.confirmPassword && <p className="text-[11px] text-red-500 mt-1 font-medium">* {supervisorErrors.confirmPassword}</p> }
                    {supervisorForm.password && supervisorForm.confirmPassword && supervisorForm.password !== supervisorForm.confirmPassword && (
                      <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
                    )}
                  </div>
                </div> */}
                <div className="border-t border-gray-100 my-4" />
                <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">
                  Documents
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">PAN Card Number</label>
                    <input ref={el => { if (supervisorFieldRefs.current) supervisorFieldRefs.current.pan_number = el; }}  type="text" placeholder="ABCDE1234F" value={supervisorForm.pan_number}
                      onChange={e => { setSupervisorForm({ ...supervisorForm, pan_number: e.target.value.toUpperCase().slice(0, 10)}); if (supervisorErrors.pan_number) setSupervisorErrors(prev => ({ ...prev, pan_number: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${supervisorErrors.pan_number ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E] font-mono`} />
{ supervisorErrors.pan_number && <p className="text-[11px] text-red-500 mt-1 font-medium">* {supervisorErrors.pan_number}</p> }
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Bank Account Number</label>
                    <input ref={el => { if (supervisorFieldRefs.current) supervisorFieldRefs.current.bank_account_number = el; }}  type="text" value={supervisorForm.bank_account_number} inputMode="numeric"
                      onChange={e => { setSupervisorForm({ ...supervisorForm, bank_account_number: e.target.value.replace(/\D/g, "").slice(0, 18)}); if (supervisorErrors.bank_account_number) setSupervisorErrors(prev => ({ ...prev, bank_account_number: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${supervisorErrors.bank_account_number ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`} />
{ supervisorErrors.bank_account_number && <p className="text-[11px] text-red-500 mt-1 font-medium">* {supervisorErrors.bank_account_number}</p> }
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Bank IFSC Code</label>
                    <input ref={el => { if (supervisorFieldRefs.current) supervisorFieldRefs.current.bank_ifsc = el; }}  type="text" placeholder="SBIN0001234" value={supervisorForm.bank_ifsc}
                      onChange={e => { setSupervisorForm({ ...supervisorForm, bank_ifsc: e.target.value.toUpperCase().slice(0, 11)}); if (supervisorErrors.bank_ifsc) setSupervisorErrors(prev => ({ ...prev, bank_ifsc: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${supervisorErrors.bank_ifsc ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E] font-mono`} />
{ supervisorErrors.bank_ifsc && <p className="text-[11px] text-red-500 mt-1 font-medium">* {supervisorErrors.bank_ifsc}</p> }
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Aadhar Number <span className="text-red-500">*</span></label>
                    <input ref={el => { if (supervisorFieldRefs.current) supervisorFieldRefs.current.aadhar_number = el; }}  type="text" value={supervisorForm.aadhar_number} inputMode="numeric"
                      onChange={e => { setSupervisorForm({ ...supervisorForm, aadhar_number: e.target.value.replace(/\D/g, "").slice(0, 12)}); if (supervisorErrors.aadhar_number) setSupervisorErrors(prev => ({ ...prev, aadhar_number: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${supervisorErrors.aadhar_number ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E] font-mono`} />
{ supervisorErrors.aadhar_number && <p className="text-[11px] text-red-500 mt-1 font-medium">* {supervisorErrors.aadhar_number}</p> }
                  </div>
                </div>

                <div ref={el => { if (supervisorFieldRefs.current) supervisorFieldRefs.current.supAadharPhoto = el; }}  className="mb-4">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Aadhar Photo <span className="text-red-500"> *</span></label>
                  <div className="relative group">
                    <div
                      onClick={() => document.getElementById("sup-aadhar-photo-input").click()}
                      className={`w-full border-2 border-dashed ${supervisorErrors.supAadharPhoto ? "border-red-400" : "border-gray-200"} rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer hover:border-[#1A3C6E] transition`}
                    >
                      {supAadharPhotoPreview ? (
                        <img src={supAadharPhotoPreview} alt="Aadhar"
                          className="h-24 w-full object-cover rounded-lg" />
                      ) : (
                        <>
                          <span className="text-2xl mb-1">🪪</span>
                          <span className="text-xs text-gray-400">Click to upload aadhar photo</span>
                        </>
                      )}
                    </div>
                    {supAadharPhotoPreview && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSupAadharPhotoPreview(null);
                          setSupervisorForm(prev => ({ ...prev, aadhar_photo_file: null }));
                        }}
                        className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-400 hover:text-red-500 hover:border-red-200 transition-all z-10"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <input
                    id="sup-aadhar-photo-input"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => { handleSupAadharPhoto(e); if (supervisorErrors.supAadharPhoto) setSupervisorErrors(prev => ({ ...prev, supAadharPhoto: undefined })); }}
                  />
                </div>
                {supervisorErrors.supAadharPhoto && <p className="text-[11px] text-red-500 mt-1 font-medium">* {supervisorErrors.supAadharPhoto}</p>}

                <p className="text-xs text-gray-400 mb-2"><span className="text-red-500">*</span> Required fields</p>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setSupervisorModal(false)}
                    className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50">Cancel</button>
                  <button type="submit" disabled={savingSupervisor}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-[#0F2044] text-white font-semibold hover:bg-[#1A3C6E] disabled:opacity-60 transition shadow-md">
                    {savingSupervisor ? "Saving..." : "Add Supervisor"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

    </SuperLayout>
  );
}