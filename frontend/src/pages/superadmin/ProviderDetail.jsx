import { useEffect, useState, useMemo, useCallback, } from "react";
import { createPortal } from "react-dom";
import { Link, useParams, useNavigate } from "react-router-dom";
import SuperLayout from "@/components/layout/SuperLayout";
import { State, City } from "country-state-city";
import { api, API } from "@/lib/api";
import { fmtDate, fmtDateTimeFull } from "@/lib/time";
import { toast } from "sonner";
import { ArrowLeft, Mail, Phone, Building2, Plus, X, Download, Edit2, Trash2, Eye, CheckCircle, Check, XCircle, Shield, Camera, CreditCard, Calendar, MapPin, Search, Users, Car, Star, ChevronDown, AlertTriangle, BuildingIcon, Radio, QrCode, Share2 } from "lucide-react";
import StatusBadge from "@/components/ui/StatusBadge";
import { QRCodeSVG } from "qrcode.react";
import QRCode from "qrcode";

const generateTempPassword = () => Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10).toUpperCase() + "1!";

export default function ProviderDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [p, setP] = useState(null);
  const [stats, setStats] = useState(null);

  const [showModal, setShowModal] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [limitsEditOpen, setLimitsEditOpen] = useState(false);
  const [limitsForm, setLimitsForm] = useState({ max_events: 0, max_hotels: 0, max_cars: 0 });
  const [limitsErrors, setLimitsErrors] = useState({});
  const [editForm, setEditForm] = useState({ name: "", phone: "", plan: "", email: "", address: "", city: "", state: "", provider_password: "", provider_confirm_password: "" });
  const [editErrors, setEditErrors] = useState({});
  const [driverModal, setDriverModal] = useState(false);
  const [driverErrors, setDriverErrors] = useState({});
  const [driverForm, setDriverForm] = useState({
    name: "", phone: "", pin: "", email: "", gender: "",
    pan_number: "", bank_account_number: "",
    bank_ifsc: "", driving_license_number: "",
    aadhar_number: "", aadhar_photo: ""
  });
  const [savingDriver, setSavingDriver] = useState(false);

  const [supervisorModal, setSupervisorModal] = useState(false);
  const [supervisorErrors, setSupervisorErrors] = useState({});
  const [supervisorForm, setSupervisorForm] = useState({
    name: "", email: "", phone: "", password: "", confirmPassword: "", gender: "",
    pan_number: "", bank_account_number: "", bank_ifsc: "", supervisor_photo: "",
    aadhar_number: "", aadhar_photo: ""
  });
  const [savingSupervisor, setSavingSupervisor] = useState(false);

  const [hotels, setHotels] = useState([]);
  const [loadingHotels, setLoadingHotels] = useState(false);
  const [hotelModal, setHotelModal] = useState(false);
  const [hotelErrors, setHotelErrors] = useState({});


  const [uploadingHotelPhoto, setUploadingHotelPhoto] = useState(false);
  const [savingHotel, setSavingHotel] = useState(false);
  const [zones, setZones] = useState([{ name: "A", slots: "" }]);
  const [gates, setGates] = useState(["Main Gate"]);
  const [hotelForm, setHotelForm] = useState({
    name: "", address: "", city: "", state: "",
    contact_person_name: "", contact_person_phone: "", contact_person_email: "",
    total_valet_slots: "",
    gate_timer_minutes: "5",
    hotel_photo: ""
  });

  const totalHotelSlots = useMemo(() => zones.reduce((sum, z) => sum + (parseInt(z.slots) || 0), 0), [zones]);

  // Auto-update first zone's slots when total_valet_slots changes and there's only one zone

  useEffect(() => {
    if (zones.length === 1 && hotelForm.total_valet_slots) {
      setZones([{ ...zones[0], slots: hotelForm.total_valet_slots }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelForm.total_valet_slots, zones.length]);

  const [licensePhotoFile, setLicensePhotoFile] = useState(null);
  const [licensePhotoPreview, setLicensePhotoPreview] = useState(null);
  const [uploadingLicense, setUploadingLicense] = useState(false);

  const [drvAadharPhotoFile, setDrvAadharPhotoFile] = useState(null);
  const [drvAadharPhotoPreview, setDrvAadharPhotoPreview] = useState(null);

  const [supAadharPhotoFile, setSupAadharPhotoFile] = useState(null);
  const [supAadharPhotoPreview, setSupAadharPhotoPreview] = useState(null);

  const [driverPhotoFile, setDriverPhotoFile] = useState(null);
  const [driverPhotoPreview, setDriverPhotoPreview] = useState(null);
  const [uploadingDriverPhoto, setUploadingDriverPhoto] = useState(false);
  const [supervisorPhotoPreview, setSupervisorPhotoPreview] = useState(null);

  const [providerCars, setProviderCars] = useState([]);
  const [loadingCars, setLoadingCars] = useState(false);
  const [carSearch, setCarSearch] = useState("");
  const [carsPage, setCarsPage] = useState(1);

  const [providerIncidents, setProviderIncidents] = useState([]);
  const [loadingIncidents, setLoadingIncidents] = useState(false);
  const [incidentSearch, setIncidentSearch] = useState("");
  const [incidentsPage, setIncidentsPage] = useState(1);

  const [providerQrCards, setProviderQrCards] = useState([]);
  const [loadingQrCards, setLoadingQrCards] = useState(false);
  const [qrSearch, setQrSearch] = useState("");
  const [debouncedQrSearch, setDebouncedQrSearch] = useState("");
  const [qrModalCard, setQrModalCard] = useState(null);

  const [selectedQrDate, setSelectedQrDate] = useState(null);
  const [qrPage, setQrPage] = useState(1);
  const QR_TAGS_PER_PAGE = 24;

  const [liveEvents, setLiveEvents] = useState([]);
  const [selectedLiveEvent, setSelectedLiveEvent] = useState(null);
  const [liveQueue, setLiveQueue] = useState([]);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [liveEventSearch, setLiveEventSearch] = useState("");

  const handleLicensePhoto = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLicensePhotoFile(file);
    setLicensePhotoPreview(URL.createObjectURL(file));
  };

  const handleDriverAadharPhoto = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setDrvAadharPhotoFile(file);
    setDrvAadharPhotoPreview(URL.createObjectURL(file));
  };

  const handleSupAadharPhoto = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setSupAadharPhotoFile(file);
    setSupAadharPhotoPreview(URL.createObjectURL(file));
  };

  const handleDriverPhoto = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setDriverPhotoFile(file);
    setDriverPhotoPreview(URL.createObjectURL(file));
  };

  const handleHotelPhotoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingHotelPhoto(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "hotels");
      const { data } = await api.post("/upload", fd);
      setHotelForm(prev => ({ ...prev, hotel_photo: data.url }));
      toast.success("Hotel photo uploaded");
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploadingHotelPhoto(false);
    }
  };

  const validateHotel = () => {
    const errs = {};
    if (!hotelForm.name.trim()) errs.name = "Hotel name is required";
    if (!hotelForm.address.trim()) errs.address = "Address is required";
    if (!hotelForm.state) errs.state = "State is required";
    if (!hotelForm.city) errs.city = "City is required";
    if (!hotelForm.contact_person_name.trim()) errs.contact_person_name = "Contact person name is required";
    if (!hotelForm.contact_person_phone.trim()) errs.contact_person_phone = "Contact person phone is required";
    else if (!/^\d{10}$/.test(hotelForm.contact_person_phone.replace(/\D/g, ""))) errs.contact_person_phone = "Please enter a valid 10-digit phone number";
    if (hotelForm.contact_person_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hotelForm.contact_person_email.trim())) errs.contact_person_email = "Please enter a valid email address";
    if (!hotelForm.total_valet_slots || isNaN(parseInt(hotelForm.total_valet_slots)) || parseInt(hotelForm.total_valet_slots) <= 0) errs.total_valet_slots = "Total valet slots must be a number greater than 0";
    return errs;
  };

  const submitHotel = async (e) => {
    e.preventDefault();
    if (savingHotel) return;
    const errs = validateHotel();
    setHotelErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSavingHotel(true);
    try {
      const body = {
        ...hotelForm,
        state: hotelForm.state,
        provider_id: id,
        total_valet_slots: parseInt(hotelForm.total_valet_slots),
        zones: zones.map(z => ({ name: z.name.trim(), slots: parseInt(z.slots) || 0 })).filter(z => z.name),
        gates: gates.filter(g => g.trim()),
      };
      await api.post("/hotels", body);
      toast.success("Hotel created successfully");
      setHotelErrors({});
      setHotelModal(false);
      // Reset all new state
      setZones([{ name: "A", slots: "" }]);
      setGates(["Main Gate"]);
      setHotelForm({
        name: "", address: "", city: "", state: "",
        contact_person_name: "", contact_person_phone: "", contact_person_email: "",
        total_valet_slots: "",
        gate_timer_minutes: "5",
        hotel_photo: ""
      });
      load();
    } catch (err) {
      const detail = err.response?.data?.detail;
      let message = "Failed to create hotel";
      if (typeof detail === "string") {
        message = detail;
      } else if (Array.isArray(detail) && detail.length > 0) {
        message = detail.map(d => d.msg || JSON.stringify(d)).join(", ");
      }
      toast.error(message);
    } finally {
      setSavingHotel(false);
    }
  };



  const [errors, setErrors] = useState({});
  const [form, setForm] = useState({
    name: "", date: "", end_date: "", venue: "", max_cars: 50, gate_timer_minutes: 5, allow_instant_park: false,
    start_time: "00:00", end_time: "23:59", gates: "Main Gate",
    zones: [{ name: "A", slots: 20 }]
  });

  const totalSlots = form.zones.reduce((sum, z) => sum + (parseInt(z.slots) || 0), 0);

  const [openDropdown, setOpenDropdown] = useState(null);
  const [activeTab, setActiveTab] = useState("info");

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest('.filter-dropdown-container')) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!hotelModal && !showModal && !driverModal && !supervisorModal && !editOpen) return;
    const handleEsc = (e) => {
      if (e.key === "Escape") {
        if (showModal) setShowModal(false);
        else if (editOpen) setEditOpen(false);
        else if (driverModal) closeDriverModal();
        else if (supervisorModal) setSupervisorModal(false);
        else if (hotelModal) setHotelModal(false);
      }
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [hotelModal, showModal, driverModal, supervisorModal, editOpen]);

  const [driverSearch, setDriverSearch] = useState("");
  const [driverStatusFilter, setDriverStatusFilter] = useState("All");

  const [eventSearch, setEventSearch] = useState("");
  const [eventStatusFilter, setEventStatusFilter] = useState("All");
  const [eventDateFilter, setEventDateFilter] = useState("");

  const [supervisorSearch, setSupervisorSearch] = useState("");
  const [supervisorStatusFilter, setSupervisorStatusFilter] = useState("All");

  const [hotelSearch, setHotelSearch] = useState("");
  const [hotelStatusFilter, setHotelStatusFilter] = useState("All");

  const filteredDrivers = useMemo(() => {
    return (p?.drivers || []).filter(d => {
      const matchSearch = !driverSearch || `${d.name} ${d.employee_id}`.toLowerCase().includes(driverSearch.toLowerCase());
      const matchStatus = driverStatusFilter === "All" || (driverStatusFilter === "Active" ? d.is_active : !d.is_active);
      return matchSearch && matchStatus;
    });
  }, [p?.drivers, driverSearch, driverStatusFilter]);

  const filteredEvents = useMemo(() => {
    return (p?.events || [])
      .filter(e => {
        const matchSearch = !eventSearch || `${e.name} ${e.venue}`.toLowerCase().includes(eventSearch.toLowerCase());
        const matchStatus = eventStatusFilter === "All" || (eventStatusFilter === "Active" ? e.status === "active" : e.status === "closed");
        const matchDate = !eventDateFilter || e.date === eventDateFilter;
        return matchSearch && matchStatus && matchDate;
      })
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  }, [p?.events, eventSearch, eventStatusFilter, eventDateFilter]);

  const filteredSupervisors = useMemo(() => {
    return (p?.supervisors || []).filter(s => {
      const matchSearch = !supervisorSearch || `${s.name} ${s.email}`.toLowerCase().includes(supervisorSearch.toLowerCase());
      const matchStatus = supervisorStatusFilter === "All" || (supervisorStatusFilter === "Active" ? s.is_active : !s.is_active);
      return matchSearch && matchStatus;
    });
  }, [p?.supervisors, supervisorSearch, supervisorStatusFilter]);

  const filteredCars = useMemo(() =>
    providerCars.filter(c =>
      !carSearch || c.plate?.toLowerCase().includes(carSearch.toLowerCase()) ||
      c.make?.toLowerCase().includes(carSearch.toLowerCase())
    ), [providerCars, carSearch]);
  const paginatedCars = filteredCars.slice((carsPage - 1) * 10, carsPage * 10);

  const filteredIncidents = useMemo(() =>
    providerIncidents.filter(i =>
      !incidentSearch || i.description?.toLowerCase().includes(incidentSearch.toLowerCase()) ||
      i.event_name?.toLowerCase().includes(incidentSearch.toLowerCase())
    ), [providerIncidents, incidentSearch]);
  const paginatedIncidents = filteredIncidents.slice((incidentsPage - 1) * 10, incidentsPage * 10);

  const filteredHotels = useMemo(() => {
    return (hotels || []).filter(h => {
      const matchSearch = !hotelSearch || `${h.name} ${h.city}`.toLowerCase().includes(hotelSearch.toLowerCase());
      const matchStatus = hotelStatusFilter === "All" || (hotelStatusFilter === "Active" ? h.is_active : !h.is_active);
      return matchSearch && matchStatus;
    });
  }, [hotels, hotelSearch, hotelStatusFilter]);

  const [eventsPage, setEventsPage] = useState(1);

  const [qrIncidentHistory, setQrIncidentHistory] = useState([]);
  const [loadingQrHistory, setLoadingQrHistory] = useState(false);

  const [driversPage, setDriversPage] = useState(1);
  const [supervisorsPage, setSupervisorsPage] = useState(1);
  const [hotelsPage, setHotelsPage] = useState(1);

  const paginatedEvents = filteredEvents.slice((eventsPage - 1) * 10, eventsPage * 10);
  const paginatedDrivers = filteredDrivers.slice((driversPage - 1) * 10, driversPage * 10);
  const paginatedSupervisors = filteredSupervisors.slice((supervisorsPage - 1) * 10, supervisorsPage * 10);
  const paginatedHotels = filteredHotels.slice((hotelsPage - 1) * 10, hotelsPage * 10);

  const formatMemberSince = (dateStr) => {
    if (!dateStr) return null;
    try {
      return fmtDate(dateStr);
    } catch {
      return null;
    }
  };

  const load = async () => {
    try {
      const [a, b] = await Promise.all([
        api.get(`/providers/${id}`),
        api.get(`/providers/${id}/stats`),
      ]);
      const providerData = a.data;
      setP(providerData);
      setStats(b.data);
      setEditForm({
        name: providerData.name,
        phone: providerData.phone,
        plan: providerData.plan,
        email: providerData.email || "",
        address: providerData.address || "",
        city: providerData.city || "",
        state: providerData.state || ""
      });

      if (providerData.provider_type === "valet_provider") {
        setLoadingHotels(true);
        try {
          const resHotels = await api.get(`/hotels?provider_id=${id}`);
          setHotels(resHotels.data);
        } catch {
          toast.error("Failed to load hotels");
        } finally {
          setLoadingHotels(false);
        }
      }
    } catch { toast.error("Failed to load provider"); }
  };

  const generateProviderPDF = async () => {
    try {
      const { data } = await api.get(
        `/providers/${id}/report`
      );
      const prov = data.provider;
      const s = data.summary;

      const formatPdfDate = (iso) => {
        if (!iso) return "—";
        try {
          return fmtDate(iso);
        } catch {
          return "—";
        }
      };

      const memberSince = prov.created_at
        ? fmtDate(prov.created_at)
        : "—";

      const eventRows = data.events.map(e => `
      <tr>
        <td style="padding:8px 10px;font-weight:700;">
          ${e.name}
        </td>
        <td style="padding:8px 10px;">${e.date || "—"}</td>
        <td style="padding:8px 10px;">${e.venue || "—"}</td>
        <td style="padding:8px 10px;text-align:center;">
          ${e.total_cars}
        </td>
        <td style="padding:8px 10px;text-align:center;">
          ${e.delivered}
        </td>
        <td style="padding:8px 10px;">
          <span style="background:${e.status === "closed"
          ? "#D1FAE5" : "#FEF3C7"
        };color:${e.status === "closed"
          ? "#065F46" : "#92400E"
        };padding:2px 8px;border-radius:99px;
          font-size:11px;">${e.status}</span>
        </td>
      </tr>`
      ).join("");

      const driverRows = data.drivers.map(d => `
      <tr>
        <td style="padding:8px 10px;font-weight:700;">
          ${d.name}
        </td>
        <td style="padding:8px 10px;">${d.employee_id}</td>
        <td style="padding:8px 10px;">${d.phone}</td>
        <td style="padding:8px 10px;">${d.email || "—"}</td>
        <td style="padding:8px 10px;">
          <span style="background:${d.is_active !== false ? "#D1FAE5" : "#FEE2E2"
        };color:${d.is_active !== false ? "#065F46" : "#991B1B"
        };padding:2px 8px;border-radius:99px;
          font-size:11px;">
            ${d.is_active !== false ? "Active" : "Inactive"}
          </span>
        </td>
      </tr>`
      ).join("");

      const supervisorRows = data.supervisors.map(s => `
      <tr>
        <td style="padding:8px 10px;font-weight:700;">
          ${s.name}
        </td>
        <td style="padding:8px 10px;">${s.email}</td>
        <td style="padding:8px 10px;">${s.phone}</td>
        <td style="padding:8px 10px;">
          <span style="background:${s.is_active !== false ? "#D1FAE5" : "#FEE2E2"
        };color:${s.is_active !== false ? "#065F46" : "#991B1B"
        };padding:2px 8px;border-radius:99px;
          font-size:11px;">
            ${s.is_active !== false ? "Active" : "Inactive"}
          </span>
        </td>
      </tr>`
      ).join("");

      const incidentRows = (data.incidents || []).map(inc => `
      <tr>
        <td style="padding:8px 10px;">${formatPdfDate(inc.created_at)}</td>
        <td style="padding:8px 10px;font-weight:700;">
          ${inc.plate || "—"}
        </td>
        <td style="padding:8px 10px;">${inc.description || "—"}</td>
        <td style="padding:8px 10px;">${inc.driver_name || "—"}</td>
      </tr>`
      ).join("");

      const html = `<!DOCTYPE html><html><head>
      <meta charset="UTF-8">
      <style>
        *{margin:0;padding:0;box-sizing:border-box;}
        body{font-family:Arial,sans-serif;color:#111827;
          font-size:13px;}
        .header{background:#0F2044;color:white;
          padding:28px 32px;}
        .header h1{font-size:24px;font-weight:900;}
        .header p{opacity:0.7;margin-top:4px;font-size:13px;}
        .section{padding:22px 32px;
          border-bottom:1px solid #f3f4f6;}
        .section h2{font-size:11px;font-weight:800;
          color:#0F2044;letter-spacing:3px;
          margin-bottom:14px;text-transform:uppercase;}
        .stats{display:flex;gap:12px;flex-wrap:wrap;}
        .stat{background:#f9fafb;border-radius:10px;
          padding:12px 16px;text-align:center;flex:1;
          min-width:80px;}
        .stat-val{font-size:22px;font-weight:900;
          color:#111827;}
        .stat-lbl{font-size:9px;color:#6b7280;
          text-transform:uppercase;letter-spacing:1px;
          margin-top:3px;}
        table{width:100%;border-collapse:collapse;
          font-size:12px;}
        th{padding:8px 10px;text-align:left;
          background:#f9fafb;font-size:10px;
          text-transform:uppercase;letter-spacing:1px;
          color:#6b7280;font-weight:700;
          border-bottom:1px solid #e5e7eb;}
        .footer{padding:16px 32px;text-align:center;
          color:#9ca3af;font-size:11px;}
      </style></head><body>
      <div class="header">
        <h1>${prov.name}</h1>
        <p>${prov.email} · ${prov.phone || "—"}
          · Plan: ${prov.plan?.toUpperCase() || "—"}
          · Member since ${memberSince}</p>
        <p style="margin-top:8px;font-size:11px;opacity:0.5;">
          Provider Report · Generated
          ${fmtDateTimeFull(new Date().toISOString())}
        </p>
      </div>
      <div class="section">
        <h2>Summary</h2>
        <div class="stats">
          ${[
          ["Events", s.total_events],
          ["Total Cars", s.total_cars],
          ["Delivered", s.total_delivered],
          ["Drivers", s.total_drivers],
          ["Supervisors", s.total_supervisors],
          ["Incidents", s.total_incidents],
          ["Platform Rating", s.platform_avg_rating > 0 ? s.platform_avg_rating + "★" : "-"],
          ["Driver Rating", s.driver_avg_rating > 0 ? s.driver_avg_rating + "★" : "-"],
          ["Avg Duration", s.avg_duration_minutes > 0
            ? s.avg_duration_minutes + " min" : "—"],
        ].map(([label, value]) => `
            <div class="stat">
              <div class="stat-val">${value}</div>
              <div class="stat-lbl">${label}</div>
            </div>`
        ).join("")}
        </div>
      </div>
      <div class="section">
        <h2>Events (${data.events.length})</h2>
        <table><thead><tr>
          <th>Event</th><th>Date</th><th>Venue</th>
          <th>Cars</th><th>Delivered</th><th>Status</th>
        </tr></thead>
        <tbody>${eventRows}</tbody></table>
      </div>
      <div class="section">
        <h2>Drivers (${data.drivers.length})</h2>
        <table><thead><tr>
          <th>Name</th><th>Employee ID</th>
          <th>Phone</th><th>Email</th><th>Status</th>
        </tr></thead>
        <tbody>${driverRows}</tbody></table>
      </div>
      <div class="section">
        <h2>Supervisors (${data.supervisors.length})</h2>
        <table><thead><tr>
          <th>Name</th><th>Email</th>
          <th>Phone</th><th>Status</th>
        </tr></thead>
        <tbody>${supervisorRows}</tbody></table>
      </div>
      ${(data.incidents || []).length > 0 ? `
      <div class="section">
        <h2>Incidents (${(data.incidents || []).length})</h2>
        <table><thead><tr>
          <th>Date</th><th>Plate</th>
          <th>Description</th><th>Driver</th>
        </tr></thead>
        <tbody>${incidentRows}</tbody>
      </div>` : ""}
      <div class="footer">
        InstaPark — Smart Valet Operations ·
        ${prov.name} Provider Report
      </div>
    </body></html>`;

      const w = window.open("", "_blank");
      w.document.write(html);
      w.document.close();
      setTimeout(() => w.print(), 500);
      toast.success("Provider report ready to print/save");
    } catch {
      toast.error("Failed to generate provider report");
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    if (activeTab === "cars" && providerCars.length === 0) {
      setLoadingCars(true);
      api.get(`/superadmin/cars?provider_id=${id}`)
        .then(r => setProviderCars(r.data))
        .catch(() => toast.error("Failed to load cars"))
        .finally(() => setLoadingCars(false));
    }
    if (activeTab === "incidents" && providerIncidents.length === 0) {
      setLoadingIncidents(true);
      api.get(`/providers/${id}/incidents`)
        .then(r => setProviderIncidents(r.data))
        .catch(() => toast.error("Failed to load incidents"))
        .finally(() => setLoadingIncidents(false));
    }
    if (activeTab === "queue") {
      api.get(`/providers/${id}`)
        .then(r => {
          const activeEvents = (r.data.events || []).filter(e => e.status === "active");
          setLiveEvents(activeEvents);
          if (activeEvents.length === 1) setSelectedLiveEvent(activeEvents[0]);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQrSearch(qrSearch), 400);
    return () => clearTimeout(timer);
  }, [qrSearch]);


  useEffect(() => {
    if (qrModalCard) {
      setLoadingQrHistory(true);
      api.get(`/qr-card-incidents?provider_id=${id}&key_tag_number=${qrModalCard.key_tag_number}`)
        .then(res => setQrIncidentHistory(res.data))
        .catch(() => toast.error("Failed to load history"))
        .finally(() => setLoadingQrHistory(false));
    } else {
      setQrIncidentHistory([]);
    }
  }, [qrModalCard, id]);

  const handleApproveIncident = async (incidentId) => {
    try {
      await api.post(`/qr-card-incidents/${incidentId}/approve`);
      toast.success("Incident approved. New card generated.");
      setQrModalCard(null);
      load(); // refresh data
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to approve");
    }
  };

  const handleRejectIncident = async (incidentId) => {
    try {
      await api.post(`/qr-card-incidents/${incidentId}/reject`);
      toast.success("Incident rejected. Card restored.");
      setQrModalCard(null);
      load(); // refresh data
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to reject");
    }
  };

  useEffect(() => {
    if (activeTab === "qr_codes") {
      setLoadingQrCards(true);
      api.get(`/providers/${id}/qr-cards`, { params: { search: debouncedQrSearch || undefined } })
        .then(r => setProviderQrCards(r.data.cards || []))
        .catch(() => toast.error("Failed to load QR cards"))
        .finally(() => setLoadingQrCards(false));
    }
  }, [activeTab, debouncedQrSearch, id]);

  useEffect(() => {
    if (!selectedLiveEvent) return;
    setLoadingQueue(true);
    api.get(`/events/${selectedLiveEvent.id}/queue`)
      .then(r => setLiveQueue(r.data))
      .catch(() => { })
      .finally(() => setLoadingQueue(false));
    const interval = setInterval(() => {
      api.get(`/events/${selectedLiveEvent.id}/queue`)
        .then(r => setLiveQueue(r.data)).catch(() => { });
    }, 5000);
    return () => clearInterval(interval);
  }, [selectedLiveEvent]);

  const validateEvent = () => {
    const errs = {};
    if (!form.name?.trim()) errs.name = "Event name is required";
    if (!form.date) errs.date = "Start date is required";
    if (!form.end_date) errs.end_date = "End date is required";
    else if (form.date && form.end_date < form.date) errs.end_date = "End date cannot be before start date";
    if (!form.venue?.trim()) errs.venue = "Venue is required";
    if (!form.start_time) errs.start_time = "Start time is required";
    if (!form.end_time) errs.end_time = "End time is required";
    if (!form.max_cars || form.max_cars < 1) errs.max_cars = "Max cars must be at least 1";
    return errs;
  };

  const handleCreateEvent = async (e) => {
    e.preventDefault();
    const errs = validateEvent();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    if (totalSlots > form.max_cars) {
      toast.error(`Total slots (${totalSlots}) cannot exceed max cars (${form.max_cars}). Reduce zone slots.`);
      return;
    }
    try {
      const body = {
        ...form,
        provider_id: id,
        zones: form.zones.filter(z => z.name.trim()),
        gates: form.gates.split(",").map(g => g.trim()).filter(g => g)
      };
      await api.post("/events", body);
      toast.success("Event created");
      setShowModal(false);
      setForm({
        name: "", date: "", end_date: "", venue: "", max_cars: 50, gate_timer_minutes: 5, allow_instant_park: false,
        start_time: "00:00", end_time: "23:59", gates: "Main Gate",
        key_hook_start: 1, key_hook_end: 50,
        zones: [{ name: "A", slots: 20 }]
      });
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to create event");
    }
  };

  const validateEdit = () => {
    const errs = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editForm.email.trim())) errs.email = "Please enter a valid email address";
    if (!/^\d{10}$/.test(editForm.phone.replace(/\D/g, ""))) errs.phone = "Please enter a valid 10-digit phone number";
    if (editForm.provider_password && editForm.provider_password.length < 8) errs.provider_password = "Password must be at least 8 characters";
    if (editForm.provider_password !== editForm.provider_confirm_password) errs.provider_confirm_password = "Passwords do not match";
    
    if (p?.provider_type === "valet_provider") {
    }

    return errs;
  };

  const handleEdit = async (e) => {
    e.preventDefault();
    const errs = validateEdit();
    setEditErrors(errs);
    if (Object.keys(errs).length > 0) return;
    try {
      const payload = { ...editForm };
      delete payload.provider_confirm_password;
      if (!payload.provider_password) delete payload.provider_password;
      else { payload.password = payload.provider_password; delete payload.provider_password; }
      
      if (p?.provider_type === "valet_provider") {
        payload.max_events = payload.max_events !== "" ? parseInt(payload.max_events) : 0;
        payload.max_hotels = payload.max_hotels !== "" ? parseInt(payload.max_hotels) : 0;
        payload.max_cars = payload.max_cars !== "" ? parseInt(payload.max_cars) : 0;
      } else {
        delete payload.max_events;
        delete payload.max_hotels;
        delete payload.max_cars;
      }

      await api.patch(`/providers/${id}`, payload);
      toast.success("Provider updated");
      setEditErrors({});
      setEditOpen(false);
      setEditForm(prev => ({ ...prev, provider_password: "", provider_confirm_password: "" }));
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to update");
    }
  };

  const closeDriverModal = () => {
    setDriverModal(false);
    setDriverErrors({});
    setDriverForm({
      name: "", phone: "", pin: "", email: "", gender: "",
      pan_number: "", bank_account_number: "",
      bank_ifsc: "", driving_license_number: "",
      aadhar_number: "", aadhar_photo: ""
    });
    setLicensePhotoFile(null);
    setLicensePhotoPreview(null);
    setDrvAadharPhotoFile(null);
    setDrvAadharPhotoPreview(null);
    setDriverPhotoFile(null);
    setDriverPhotoPreview(null);
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

    if (!licensePhotoFile && !licensePhotoPreview) errs.licensePhoto = "Driving License Photo is required";
    if (!drvAadharPhotoFile && !drvAadharPhotoPreview) errs.drvAadharPhoto = "Aadhar Photo is required";
    return errs;
  };

  const handleAddDriver = async (e) => {
    e.preventDefault();
    const errs = validateDriver();
    setDriverErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSavingDriver(true);

    let licensePhotoUrl = undefined;
    if (licensePhotoFile) {
      setUploadingLicense(true);
      try {
        const fd = new FormData();
        fd.append("file", licensePhotoFile);
        fd.append("folder", "driving_licenses");
        const up = await api.post("/upload", fd, {
          headers: { "Content-Type": "multipart/form-data" }
        });
        licensePhotoUrl = up.data.url;
      } catch { toast.error("License photo upload failed, saving without it."); }
      finally { setUploadingLicense(false); }
    }

    let aadharPhotoUrl = undefined;
    if (drvAadharPhotoFile) {
      try {
        const fd = new FormData();
        fd.append("file", drvAadharPhotoFile);
        fd.append("folder", "aadhar_photos");
        const up = await api.post("/upload", fd, {
          headers: { "Content-Type": "multipart/form-data" }
        });
        aadharPhotoUrl = up.data.url;
      } catch { toast.error("Aadhar photo upload failed, saving without it."); }
    }

    let driverPhotoUrl = undefined;
    if (driverPhotoFile) {
      setUploadingDriverPhoto(true);
      try {
        const fd = new FormData();
        fd.append("file", driverPhotoFile);
        fd.append("folder", "driver_photos");
        const up = await api.post("/upload", fd, {
          headers: { "Content-Type": "multipart/form-data" }
        });
        driverPhotoUrl = up.data.url;
      } catch { toast.error("Driver photo upload failed, saving without it."); }
      finally { setUploadingDriverPhoto(false); }
    }

    try {
      const { data } = await api.post("/drivers", {
        name: driverForm.name.trim(),
        phone: driverForm.phone.trim(),
        pin: driverForm.pin,
        provider_id: id,
        email: driverForm.email.trim(),
        gender: driverForm.gender,
        pan_number: driverForm.pan_number.trim(),
        bank_account_number: driverForm.bank_account_number.trim(),
        bank_ifsc: driverForm.bank_ifsc.trim().toUpperCase(),
        driving_license_number: driverForm.driving_license_number.trim().toUpperCase(),
        driving_license_photo: licensePhotoUrl,
        aadhar_number: driverForm.aadhar_number.trim(),
        aadhar_photo: aadharPhotoUrl,
        driver_photo: driverPhotoUrl,
      });
      toast.success(`Driver created! Employee ID: ${data.employee_id} | PIN: ${data.pin}`);
      closeDriverModal();
      load(); // reload provider data to refresh driver list 
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to create driver");
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

    if (!supAadharPhotoFile && !supAadharPhotoPreview) errs.supAadharPhoto = "Aadhar Photo is required";
    return errs;
  };

  const handleAddSupervisor = async (e) => {
    e.preventDefault();
    const errs = validateSupervisor();
    setSupervisorErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSavingSupervisor(true);

    let aadharPhotoUrl = undefined;
    if (supAadharPhotoFile) {
      try {
        const fd = new FormData();
        fd.append("file", supAadharPhotoFile);
        fd.append("folder", "aadhar_photos");
        const up = await api.post("/upload", fd, {
          headers: { "Content-Type": "multipart/form-data" }
        });
        aadharPhotoUrl = up.data.url;
      } catch { toast.error("Aadhar photo upload failed, saving without it."); }
    }

    let supervisorPhotoUrl = undefined;
    if (supervisorForm.supervisor_photo_file) {
      try {
        const fd = new FormData();
        fd.append("file", supervisorForm.supervisor_photo_file);
        fd.append("folder", "supervisors");
        const up = await api.post("/upload", fd, {
          headers: { "Content-Type": "multipart/form-data" }
        });
        supervisorPhotoUrl = up.data.url;
      } catch { toast.error("Supervisor photo upload failed, saving without it."); }
    }

    try {
      await api.post("/supervisors", {
        ...supervisorForm,
        provider_id: id,
        email: supervisorForm.email.trim(),
        gender: supervisorForm.gender,
        password: generateTempPassword(),
        confirmPassword: undefined,
        pan_number: supervisorForm.pan_number.trim(),
        bank_account_number: supervisorForm.bank_account_number.trim(),
        bank_ifsc: supervisorForm.bank_ifsc.trim().toUpperCase(),
        aadhar_number: supervisorForm.aadhar_number.trim(),
        aadhar_photo: aadharPhotoUrl,
        supervisor_photo: supervisorPhotoUrl || undefined
      });
      toast.success("Supervisor created successfully");
      setSupervisorModal(false);
      setSupervisorForm({
        name: "", email: "", phone: "", password: "", confirmPassword: "", gender: "",
        pan_number: "", bank_account_number: "", bank_ifsc: "", supervisor_photo: "", supervisor_photo_file: null
      });
      setSupervisorPhotoPreview(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to create supervisor");
    } finally {
      setSavingSupervisor(false);
    }
  };



  const handleDeactivateSupervisor = async (sid, active) => {
    if (!window.confirm(`Are you sure you want to ${active ? "deactivate" : "reactivate"} this supervisor?`)) return;
    try {
      if (active) {
        await api.delete(`/supervisors/${sid}`);
      } else {
        await api.patch(`/supervisors/${sid}`, { is_active: true });
      }
      toast.success(`Supervisor ${active ? "deactivated" : "reactivated"}`);
      load();
    } catch (err) {
      toast.error("Operation failed");
    }
  };

  const toggle = async () => {
    try {
      await api.patch(`/providers/${id}/toggle-active`);
      toast.success(p.is_active ? "Marked inactive" : "Marked active");
      load();
    } catch { toast.error("Failed"); }
  };





  const handleLimitsEdit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (limitsForm.max_events !== "" && parseInt(limitsForm.max_events) < 0) errs.max_events = "Cannot be negative";
    if (limitsForm.max_hotels !== "" && parseInt(limitsForm.max_hotels) < 0) errs.max_hotels = "Cannot be negative";
    if (limitsForm.max_cars !== "" && parseInt(limitsForm.max_cars) < 0) errs.max_cars = "Cannot be negative";
    setLimitsErrors(errs);
    if (Object.keys(errs).length > 0) return;
    try {
      await api.patch(`/providers/${p.id}`, {
        max_events: parseInt(limitsForm.max_events) || 0,
        max_hotels: parseInt(limitsForm.max_hotels) || 0,
        max_cars: parseInt(limitsForm.max_cars) || 0,
      });
      toast.success("Limits updated");
      setLimitsEditOpen(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to update limits");
    }
  };

  const getDateKey = (iso) => {
    if (!iso) return "unknown";
    const utcStr = iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z";
    return new Date(utcStr).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // yyyy-mm-dd, stable sort key
  };

  const qrGroupsByDate = useMemo(() => {
    const map = new Map();
    for (const c of providerQrCards) {
      const key = getDateKey(c.created_at);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(c);
    }
    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0)) // newest date first
      .map(([dateKey, cards]) => ({
        dateKey,
        label: dateKey === "unknown" ? "Unknown Date" : fmtDate(cards[0].created_at),
        cards,
      }));
  }, [providerQrCards]);

  const allQrGroup = useMemo(() => ({
    dateKey: "all",
    label: "All",
    cards: [...providerQrCards].sort((a, b) => {
      const na = Number(a.key_tag_number), nb = Number(b.key_tag_number);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return String(a.key_tag_number).localeCompare(String(b.key_tag_number));
    }),
  }), [providerQrCards]);

  useEffect(() => {
    if (qrGroupsByDate.length === 0) {
      setSelectedQrDate(null);
      return;
    }
    const stillExists = selectedQrDate === "all" || qrGroupsByDate.some(g => g.dateKey === selectedQrDate);
    if (!stillExists) {
      setSelectedQrDate(qrGroupsByDate[0].dateKey); // latest date
      setQrPage(1);
    }
  }, [qrGroupsByDate]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setQrPage(1);
  }, [selectedQrDate]);

  const selectedQrGroup = selectedQrDate === "all" ? allQrGroup : (qrGroupsByDate.find(g => g.dateKey === selectedQrDate) || null);
  const qrTotalPages = selectedQrGroup ? Math.max(1, Math.ceil(selectedQrGroup.cards.length / QR_TAGS_PER_PAGE)) : 1;
  const qrVisibleCards = selectedQrGroup
    ? selectedQrGroup.cards.slice((qrPage - 1) * QR_TAGS_PER_PAGE, (qrPage - 1) * QR_TAGS_PER_PAGE + QR_TAGS_PER_PAGE)
    : [];

  const qrCardToPngDataUrl = (card) =>
    QRCode.toDataURL(`${API}/qr-redirect/${card.qr_token}`, {
      width: 300,
      margin: 2,
      color: { dark: "#0F2044", light: "#FFFFFF" },
    });

  const handleDownloadDateGroup = async (group) => {
    if (group.cards.length > 5) {
      const ok = window.confirm(`This will download ${group.cards.length} QR images individually. Your browser may ask permission to allow multiple downloads — please click "Allow" if prompted. Continue?`);
      if (!ok) return;
    }
    let successCount = 0;
    for (const c of group.cards) {
      try {
        const dataUrl = await qrCardToPngDataUrl(c);
        const a = document.createElement("a");
        a.download = `Tag-${c.key_tag_number}-${group.dateKey}.png`;
        a.href = dataUrl;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        successCount++;
        await new Promise((r) => setTimeout(r, 400)); // stagger so browser doesn't drop rapid-fire downloads
      } catch {
        // skip this card, continue with the rest
      }
    }
    if (successCount === group.cards.length) {
      toast.success(`Downloaded all ${successCount} QR code(s) from ${group.label}`);
    } else {
      toast.error(`Downloaded ${successCount} of ${group.cards.length} QR code(s) from ${group.label} — some failed`);
    }
  };

  const handleShareDateGroup = async (group) => {
    try {
      const files = [];
      for (const c of group.cards) {
        const dataUrl = await qrCardToPngDataUrl(c);
        const blob = await (await fetch(dataUrl)).blob();
        files.push(new File([blob], `Tag-${c.key_tag_number}.png`, { type: "image/png" }));
      }
      if (navigator.canShare && navigator.canShare({ files })) {
        await navigator.share({
          title: `QR Codes added on ${group.label}`,
          text: `${group.cards.length} QR tag(s) added on ${group.label}`,
          files,
        });
      } else {
        const links = group.cards.map((c) => `${API}/qr-redirect/${c.qr_token}`).join("\n");
        await navigator.clipboard.writeText(links);
        toast.success(`Copied ${group.cards.length} QR link(s) from ${group.label} to clipboard`);
      }
    } catch (err) {
      if (err?.name !== "AbortError") toast.error("Failed to share QR codes for this date");
    }
  };

  if (!p) return (
    <SuperLayout title="Provider Detail">
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="w-10 h-10 rounded-full border-4 border-[#1A3C6E] border-t-transparent animate-spin" />
        <p className="text-gray-400 text-sm font-medium">Loading...</p>
      </div>
    </SuperLayout>
  );

  return (
    <SuperLayout title="Provider Detail">
      <Link to="/superadmin/providers"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-[#1A3C6E] hover:text-[#0F2044] mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Providers
      </Link>
      {/* Identity Header + Tab Bar */}
      <div className="bg-[#0F2044] rounded-2xl overflow-hidden shadow-card">
        <div className="px-4 sm:px-8 pt-4 sm:pt-8 pb-4 sm:pb-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex items-start gap-4 min-w-0">
              {p.logo_url ? (
                <img src={p.logo_url} alt={p.name} className="w-16 h-16 rounded-2xl object-cover border-2 border-white/20 shrink-0 shadow-lg" />
              ) : (
                <span className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center text-2xl shrink-0 shadow-lg">🏢</span>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="font-heading text-2xl font-bold text-white">{p.name}</h1>
                  {p?.is_verified ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
                      <Check className="w-3 h-3" /> Verified
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium">
                      <AlertTriangle className="w-3 h-3" /> Unverified
                    </span>
                  )}
                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${(p?.is_verified && p?.is_active) ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/30" : "bg-red-500/20 text-red-300 border border-red-400/30"}`}>
                    {(p?.is_verified && p?.is_active) ? "Active" : "Inactive"}
                  </span>
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-white/10 text-white/90 border border-white/20">
                    {p.plan ? p.plan.charAt(0).toUpperCase() + p.plan.slice(1) : "Starter"}
                  </span>
                </div>
                <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mt-1 mb-0">Valet Profile & Operations</p>
                <div className="mt-4 pt-4 border-t border-white/10 grid grid-cols-3 sm:grid-cols-7 gap-2">
                  {[
                    { label: "Events", value: stats?.events ?? "—", icon: Calendar, tab: "events" },
                    { label: "Cars", value: stats?.cars ?? "—", icon: Car, tab: "cars" },
                    { label: "Drivers", value: stats?.drivers ?? "—", icon: Users, tab: "drivers" },
                    { label: "Supervisors", value: stats?.supervisors ?? "—", icon: Shield, tab: "supervisors" },
                    { label: "Platform Rating", value: stats?.platform_avg_rating ? `${stats.platform_avg_rating}/5` : "—", icon: Star, tab: null },
                    { label: "Driver Rating", value: stats?.driver_avg_rating ? `${stats.driver_avg_rating}/5` : "—", icon: Star, tab: null },
                    { label: "Incidents", value: stats?.incidents ?? "—", icon: AlertTriangle, tab: "incidents" },
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
                      <div className="flex items-center gap-1">
                        <s.icon className="w-3 h-3 text-amber-400" />
                        <div className="text-[8px] uppercase font-bold text-white/40 tracking-wider">{s.label}</div>
                      </div>
                      <div className="text-lg font-black text-white">{s.value}</div>
                    </div>
                  ))}
                </div>

              </div>
            </div>
            <div className="flex flex-row flex-wrap items-start gap-2 shrink-0 self-start">

              <button
                onClick={generateProviderPDF}
                className="flex items-center gap-2 px-3 py-2 sm:px-4 sm:py-2 text-sm rounded-xl border border-white/30 text-white bg-white/10 hover:bg-white/20 transition font-semibold"
              >
                <Download className="w-4 h-4" />
                Download Report
              </button>
              <button
                onClick={() => {
                  const action = p.is_active ? "mark this provider inactive" : "mark this provider active";
                  if (!window.confirm(`Are you sure you want to ${action}?`)) return;
                  toggle();
                }}
                data-testid="toggle-active-btn"
                className={`px-3 py-2 sm:px-4 sm:py-2 text-sm rounded-xl font-semibold transition border ${(p?.is_verified && p?.is_active)
                  ? "border-red-400 bg-red-500/20 text-red-100 hover:bg-red-500/40"
                  : "border-emerald-300 bg-emerald-500 text-white hover:bg-emerald-600"
                  }`}
              >
                {(p?.is_verified && p?.is_active) ? "Inactive" : "Active"}
              </button>


            </div>
          </div>
        </div>

        <div className="flex bg-black/20 border-t-2 border-amber-400/20 overflow-x-auto">
          {[
            { id: "info", label: "Info", icon: Building2 },
            { id: "events", label: "Events", icon: Calendar },
            { id: "drivers", label: "Drivers", icon: Users },
            { id: "supervisors", label: "Supervisors", icon: Shield },
            ...(p.provider_type === "valet_provider" ? [{ id: "hotels", label: "Hotels", icon: BuildingIcon }] : []),
            { id: "cars", label: "Cars", icon: Car },
            { id: "qr_codes", label: "QR Codes", icon: QrCode },
            { id: "queue", label: "Live Queue", icon: Radio },
            { id: "incidents", label: "Incidents", icon: AlertTriangle },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-6 py-3.5 text-sm font-semibold transition-colors whitespace-nowrap border-b-[3px] ${activeTab === tab.id
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
            {p?.provider_type === "valet_provider" && (
              <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-6 mb-6">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                  <h3 className="font-heading text-lg font-bold text-[#0F2044]">Limits</h3>
                  {!limitsEditOpen ? (
                    <button onClick={() => {
                      setLimitsEditOpen(true);
                      setLimitsForm({
                        max_events: p.max_events ?? 0,
                        max_hotels: p.max_hotels ?? 0,
                        max_cars: p.max_cars ?? 0
                      });
                    }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1A3C6E] text-white text-xs font-bold hover:bg-[#0F2044] transition-all">
                      <Edit2 className="w-3.5 h-3.5" /> Edit
                    </button>
                  ) : null}
                </div>
                
                {!limitsEditOpen ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    <div>
                      <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Max Events (0 = Blocked)</p>
                      <p className="text-sm font-semibold text-[#0F2044]">{p.max_events ?? 0}</p>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Max Hotels/Stores (0 = Blocked)</p>
                      <p className="text-sm font-semibold text-[#0F2044]">{p.max_hotels ?? 0}</p>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Max Cars (0 = Blocked)</p>
                      <p className="text-sm font-semibold text-[#0F2044]">{p.max_cars ?? 0}</p>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleLimitsEdit} className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Max Events (0 = Blocked)</label>
                      <input type="number" min="0" value={limitsForm.max_events} onChange={e => { setLimitsForm({ ...limitsForm, max_events: e.target.value }); if (limitsErrors.max_events) setLimitsErrors(prev => ({ ...prev, max_events: undefined })); }}
                        className={`w-full px-4 py-2 rounded-xl border ${limitsErrors.max_events ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`} />
                      {limitsErrors.max_events && <p className="text-[11px] text-red-500 mt-1 font-medium">* {limitsErrors.max_events}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Max Hotels/Stores (0 = Blocked)</label>
                      <input type="number" min="0" value={limitsForm.max_hotels} onChange={e => { setLimitsForm({ ...limitsForm, max_hotels: e.target.value }); if (limitsErrors.max_hotels) setLimitsErrors(prev => ({ ...prev, max_hotels: undefined })); }}
                        className={`w-full px-4 py-2 rounded-xl border ${limitsErrors.max_hotels ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`} />
                      {limitsErrors.max_hotels && <p className="text-[11px] text-red-500 mt-1 font-medium">* {limitsErrors.max_hotels}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Max Cars (0 = Blocked)</label>
                      <input type="number" min="0" value={limitsForm.max_cars} onChange={e => { setLimitsForm({ ...limitsForm, max_cars: e.target.value }); if (limitsErrors.max_cars) setLimitsErrors(prev => ({ ...prev, max_cars: undefined })); }}
                        className={`w-full px-4 py-2 rounded-xl border ${limitsErrors.max_cars ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`} />
                      {limitsErrors.max_cars && <p className="text-[11px] text-red-500 mt-1 font-medium">* {limitsErrors.max_cars}</p>}
                    </div>

                    <div className="col-span-1 sm:col-span-3 pt-4 flex gap-3">
                      <button type="button" onClick={() => {
                        setLimitsEditOpen(false);
                        setLimitsForm({
                          max_events: p.max_events ?? 0,
                          max_hotels: p.max_hotels ?? 0,
                          max_cars: p.max_cars ?? 0
                        });
                      }}
                        className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-semibold hover:bg-gray-50 transition">
                        Cancel
                      </button>
                      <button type="submit"
                        className="flex-1 px-4 py-2.5 rounded-xl bg-[#1A3C6E] text-white font-semibold hover:bg-[#0F2044] transition">
                        Save Limits
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            <div>
              <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-6">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                  <h3 className="font-heading text-lg font-bold text-[#0F2044]">Provider Information</h3>
                  <button onClick={() => {
                    setEditOpen(true);
                    setEditForm({
                      name: p.name,
                      phone: p.phone,
                      plan: p.plan,
                      email: p.email || "",
                      address: p.address || "",
                      city: p.city || "",
                      state: p.state || "",
                      provider_password: "",
                      provider_confirm_password: ""
                    });
                  }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1A3C6E] text-white text-xs font-bold hover:bg-[#0F2044] transition-all">
                    <Edit2 className="w-3.5 h-3.5" /> Edit
                  </button>
                </div>
                {!editOpen ? (
                  <div className="space-y-5">
                    {[
                      { label: "Phone", value: p.phone || "—", icon: Phone },
                      { label: "Email", value: p.email || "—", icon: Mail },
                      { label: "Address", value: p.address || "—", icon: MapPin },
                      { label: "City", value: p.city || "—", icon: MapPin },
                      { label: "State", value: p.state || "—", icon: MapPin },
                    ].map(f => (
                      <div key={f.label}>
                        <div className="text-[10px] uppercase font-bold text-gray-400 mb-1">{f.label}</div>
                        <div className="flex items-center gap-2 text-sm font-bold text-[#0F2044]">
                          <f.icon className="w-3.5 h-3.5 text-gray-300" />
                          {f.value}
                        </div>
                      </div>
                    ))}
                    <div>
                      <div className="text-[10px] uppercase font-bold text-gray-400 mb-1">Plan</div>
                      <div className="flex items-center gap-2 text-sm font-bold text-[#0F2044]">
                        <span className="px-2 py-1 rounded-full text-xs font-bold bg-[#1A3C6E]/10 text-[#1A3C6E]">
                          {p.plan ? p.plan.charAt(0).toUpperCase() + p.plan.slice(1) : "Starter"}
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase font-bold text-gray-400 mb-1">Member Since</div>
                      <div className="flex items-center gap-2 text-sm font-bold text-[#0F2044]">
                        {formatMemberSince(p.created_at)}
                      </div>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleEdit} className="space-y-4 pt-2">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Name <span className="text-red-500">*</span></label>
                      <input type="text" value={editForm.name} onChange={e => { setEditForm({ ...editForm, name: e.target.value }); if (editErrors.name) setEditErrors(prev => ({ ...prev, name: undefined })); }}
                        className={`w-full px-4 py-2 rounded-xl border ${editErrors.name ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`} />
                      {editErrors.name && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.name}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Phone <span className="text-red-500">*</span></label>
                      <input type="text" value={editForm.phone} onChange={e => { setEditForm({ ...editForm, phone: e.target.value }); if (editErrors.phone) setEditErrors(prev => ({ ...prev, phone: undefined })); }}
                        className={`w-full px-4 py-2 rounded-xl border ${editErrors.phone ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`} />
                      {editErrors.phone && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.phone}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Email</label>
                      <input type="email" value={editForm.email} onChange={e => { setEditForm({ ...editForm, email: e.target.value }); if (editErrors.email) setEditErrors(prev => ({ ...prev, email: undefined })); }}
                        className={`w-full px-4 py-2 rounded-xl border ${editErrors.email ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`} />
                      {editErrors.email && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.email}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Address</label>
                      <input type="text" value={editForm.address} onChange={e => { setEditForm(prev => ({ ...prev, address: e.target.value })); if (editErrors.address) setEditErrors(prev => ({ ...prev, address: undefined })); }}
                        className={`w-full px-4 py-2 rounded-xl border ${editErrors.address ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`} />
                      {editErrors.address && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.address}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">State <span className="text-red-500">*</span></label>
                      <select
                        value={editForm.state || ""}
                        onChange={e => { setEditForm(prev => ({ ...prev, state: e.target.value, city: "" })); if (editErrors.state) setEditErrors(prev => ({ ...prev, state: undefined })); }}
                        className={`w-full px-4 py-2 rounded-xl border ${editErrors.state ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`}
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
                      <select
                        value={editForm.city || ""}
                        onChange={e => { setEditForm(prev => ({ ...prev, city: e.target.value })); if (editErrors.city) setEditErrors(prev => ({ ...prev, city: undefined })); }}
                        disabled={!editForm.state}
                        className={`w-full px-4 py-2 rounded-xl border ${editErrors.city ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E] disabled:opacity-50 disabled:cursor-not-allowed`}
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
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Plan</label>
                      <select value={editForm.plan} onChange={e => { setEditForm({ ...editForm, plan: e.target.value }); if (editErrors.plan) setEditErrors(prev => ({ ...prev, plan: undefined })); }}
                        className={`w-full px-4 py-2 rounded-xl border ${editErrors.plan ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`}>
                        <option value="starter">Starter</option>
                        <option value="pro">Pro</option>
                      </select>
                      {editErrors.plan && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.plan}</p>}
                    </div>


                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                        New Password (leave blank to keep current)
                      </label>
                      <input
                        type="password"
                        value={editForm.provider_password}
                        onChange={e => { setEditForm({ ...editForm, provider_password: e.target.value }); if (editErrors.provider_password) setEditErrors(prev => ({ ...prev, provider_password: undefined })); }}
                        className={`w-full px-4 py-2 rounded-xl border ${editErrors.provider_password ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`}
                      />
                      {editErrors.provider_password && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.provider_password}</p>}
                    </div>
                    {editForm.provider_password && (
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                          Confirm Password<span className="text-red-500"> *</span>
                        </label>
                        <input
                          type="password"
                          value={editForm.provider_confirm_password}
                          onChange={e => { setEditForm({ ...editForm, provider_confirm_password: e.target.value }); if (editErrors.provider_confirm_password) setEditErrors(prev => ({ ...prev, provider_confirm_password: undefined })); }}
                          className={`w-full px-4 py-2 rounded-xl border ${editErrors.provider_confirm_password ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`}
                        />
                        {editErrors.provider_confirm_password && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.provider_confirm_password}</p>}
                      </div>
                    )}

                    <p className="text-xs text-gray-400 mb-2"><span className="text-red-500">*</span> Required fields</p>
                    <div className="pt-4 flex gap-3">
                      <button type="button" onClick={() => {
                        setEditOpen(false);
                        setEditForm({
                          name: p.name,
                          phone: p.phone,
                          plan: p.plan,
                          email: p.email || "",
                          address: p.address || "",
                          city: p.city || "",
                          state: p.state || "",
                          provider_password: "",
                          provider_confirm_password: ""
                        });
                      }}
                        className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-semibold hover:bg-gray-50 transition">
                        Cancel
                      </button>
                      <button type="submit"
                        className="flex-1 px-4 py-2.5 rounded-xl bg-[#1A3C6E] text-white font-semibold hover:bg-[#0F2044] transition">
                        Save Changes
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>

          </div>
        )}

        {activeTab === "events" && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h2 className="font-heading text-lg font-semibold text-[#0F2044]">Events</h2>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full sm:w-64">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={eventSearch} onChange={e => { setEventSearch(e.target.value); setEventsPage(1); }} placeholder="Search by name or venue..." className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-[#1A3C6E]" />
                </div>
                <button onClick={() => { setShowModal(true); setTimeout(() => { const el = document.getElementById('modal-create-event'); if (el) el.scrollTop = 0; }, 50); }}
                  className="inline-flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition">
                  <Plus className="w-4 h-4" /> Create Event
                </button>
              </div>
            </div>
            {(eventStatusFilter !== "All" || eventDateFilter) && (
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                {eventStatusFilter !== "All" && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1A3C6E]/10 text-[#1A3C6E] text-xs font-semibold">
                    Status: {eventStatusFilter} <button onClick={() => { setEventStatusFilter("All"); setEventsPage(1); }}>×</button>
                  </span>
                )}
                {eventDateFilter && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1A3C6E]/10 text-[#1A3C6E] text-xs font-semibold">
                    Date: {eventDateFilter} <button onClick={() => { setEventDateFilter(""); setEventsPage(1); }}>×</button>
                  </span>
                )}
              </div>
            )}
            <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden mb-6">
              <div className="overflow-x-auto w-full max-w-full">
                <table className="w-full text-sm min-w-[600px]">
                  <thead className="bg-gray-50 text-gray-500 uppercase text-xs tracking-wider">
                    <tr>
                      <th className="text-left px-5 py-3">Name</th>
                      <th className="text-left px-5 py-3 relative filter-dropdown-container">
                        <span
                          onClick={() => setOpenDropdown(openDropdown === 'eventDate' ? null : 'eventDate')}
                          className={`flex items-center gap-1 cursor-pointer select-none ${eventDateFilter ? "text-[#1A3C6E] font-bold" : ""}`}
                        >
                          DATE <ChevronDown className={`w-3 h-3 ${eventDateFilter ? "text-[#1A3C6E]" : ""}`} />
                        </span>
                        {openDropdown === 'eventDate' && (
                          <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg p-2 min-w-[140px] font-normal normal-case">
                            <input type="date" value={eventDateFilter} onChange={e => { setEventDateFilter(e.target.value); setEventsPage(1); setOpenDropdown(null); }} className="px-2 py-1 text-sm rounded-lg border border-gray-200 outline-none focus:border-[#1A3C6E] w-full" />
                          </div>
                        )}
                      </th>
                      <th className="text-left px-5 py-3">Venue</th>
                      <th className="text-left px-5 py-3 relative filter-dropdown-container">
                        <span
                          onClick={() => setOpenDropdown(openDropdown === 'eventStatus' ? null : 'eventStatus')}
                          className={`flex items-center gap-1 cursor-pointer select-none ${eventStatusFilter !== "All" ? "text-[#1A3C6E] font-bold" : ""}`}
                        >
                          STATUS <ChevronDown className={`w-3 h-3 ${eventStatusFilter !== "All" ? "text-[#1A3C6E]" : ""}`} />
                        </span>
                        {openDropdown === 'eventStatus' && (
                          <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg p-1 min-w-[140px] font-normal normal-case">
                            {["All", "Active", "Closed"].map(opt => (
                              <div key={opt} onClick={() => { setEventStatusFilter(opt); setEventsPage(1); setOpenDropdown(null); }} className="px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-gray-50 flex items-center gap-2">
                                {eventStatusFilter === opt ? <div className="w-2 h-2 rounded-full bg-[#1A3C6E]" /> : <div className="w-2 h-2" />}
                                {opt}
                              </div>
                            ))}
                          </div>
                        )}
                      </th>
                      <th className="text-left px-5 py-3">Max Cars</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedEvents.length === 0 && <tr><td colSpan="5" className="text-center text-gray-400 py-8">No results match your search</td></tr>}
                    {paginatedEvents.map(e => (
                      <tr key={e.id} onClick={() => nav(`/superadmin/events/${e.id}`)}
                        className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors">
                        <td className="px-5 py-3 font-medium">{e.name}</td>
                        <td className="px-5 py-3 text-gray-600">{e.date}</td>
                        <td className="px-5 py-3 text-gray-600">{e.venue}</td>
                        <td className="px-5 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${e.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>{e.status}</span>
                        </td>
                        <td className="px-5 py-3">{e.max_cars}</td>
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
            </div>
          </>
        )}

        {activeTab === "drivers" && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h2 className="font-heading text-lg font-semibold text-[#0F2044]">Drivers</h2>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full sm:w-64">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={driverSearch} onChange={e => { setDriverSearch(e.target.value); setDriversPage(1); }} placeholder="Search by name or employee ID..." className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-[#1A3C6E]" />
                </div>
                <button onClick={() => { setDriverModal(true); setTimeout(() => { const el = document.getElementById('modal-add-driver'); if (el) el.scrollTop = 0; }, 50); }}
                  className="inline-flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition">
                  <Plus className="w-4 h-4" /> Add Driver
                </button>
              </div>
            </div>
            {driverStatusFilter !== "All" && (
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1A3C6E]/10 text-[#1A3C6E] text-xs font-semibold">
                  Status: {driverStatusFilter} <button onClick={() => { setDriverStatusFilter("All"); setDriversPage(1); }}>×</button>
                </span>
              </div>
            )}
            <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden mb-6">
              <div className="overflow-x-auto w-full max-w-full">
                <table className="w-full text-sm min-w-[600px]">
                  <thead className="bg-gray-50 text-gray-500 uppercase text-xs tracking-wider">
                    <tr>
                      <th className="text-left px-5 py-3">Name</th>
                      <th className="text-left px-5 py-3">Employee ID</th>
                      <th className="text-left px-5 py-3 relative filter-dropdown-container">
                        <span
                          onClick={() => setOpenDropdown(openDropdown === 'driverStatus' ? null : 'driverStatus')}
                          className={`flex items-center gap-1 cursor-pointer select-none ${driverStatusFilter !== "All" ? "text-[#1A3C6E] font-bold" : ""}`}
                        >
                          STATUS <ChevronDown className={`w-3 h-3 ${driverStatusFilter !== "All" ? "text-[#1A3C6E]" : ""}`} />
                        </span>
                        {openDropdown === 'driverStatus' && (
                          <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg p-1 min-w-[140px] font-normal normal-case">
                            {["All", "Active", "Inactive"].map(opt => (
                              <div key={opt} onClick={() => { setDriverStatusFilter(opt); setDriversPage(1); setOpenDropdown(null); }} className="px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-gray-50 flex items-center gap-2">
                                {driverStatusFilter === opt ? <div className="w-2 h-2 rounded-full bg-[#1A3C6E]" /> : <div className="w-2 h-2" />}
                                {opt}
                              </div>
                            ))}
                          </div>
                        )}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedDrivers.length === 0 && <tr><td colSpan="3" className="text-center text-gray-400 py-8">No results match your search</td></tr>}
                    {paginatedDrivers.map(d => (
                      <tr key={d.id} onClick={() => nav(`/superadmin/drivers/${d.id}`)}
                        className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors">
                        <td className="px-5 py-3 font-semibold text-[#1A3C6E]">{d.name}</td>
                        <td className="px-5 py-3 font-mono text-gray-600">{d.employee_id}</td>
                        <td className="px-5 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${d.is_active ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{d.is_active ? "Active" : "Inactive"}</span>
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
            </div>
          </>
        )}

        {activeTab === "supervisors" && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h2 className="font-heading text-lg font-semibold text-[#0F2044]">Supervisors</h2>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full sm:w-64">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={supervisorSearch} onChange={e => { setSupervisorSearch(e.target.value); setSupervisorsPage(1); }} placeholder="Search by name or email..." className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-[#1A3C6E]" />
                </div>
                <button onClick={() => { setSupervisorModal(true); setTimeout(() => { const el = document.getElementById('modal-add-supervisor'); if (el) el.scrollTop = 0; }, 50); }}
                  className="inline-flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition">
                  <Plus className="w-4 h-4" /> Add Supervisor
                </button>
              </div>
            </div>
            {supervisorStatusFilter !== "All" && (
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1A3C6E]/10 text-[#1A3C6E] text-xs font-semibold">
                  Status: {supervisorStatusFilter} <button onClick={() => { setSupervisorStatusFilter("All"); setSupervisorsPage(1); }}>×</button>
                </span>
              </div>
            )}
            <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden mb-6">
              <div className="overflow-x-auto w-full max-w-full">
                <table className="w-full text-sm min-w-[600px]">
                  <thead className="bg-gray-50 text-gray-500 uppercase text-xs tracking-wider">
                    <tr>
                      <th className="text-left px-5 py-3">Name</th>
                      <th className="text-left px-5 py-3">Email</th>
                      <th className="text-left px-5 py-3 relative filter-dropdown-container">
                        <span
                          onClick={() => setOpenDropdown(openDropdown === 'supervisorStatus' ? null : 'supervisorStatus')}
                          className={`flex items-center gap-1 cursor-pointer select-none ${supervisorStatusFilter !== "All" ? "text-[#1A3C6E] font-bold" : ""}`}
                        >
                          STATUS <ChevronDown className={`w-3 h-3 ${supervisorStatusFilter !== "All" ? "text-[#1A3C6E]" : ""}`} />
                        </span>
                        {openDropdown === 'supervisorStatus' && (
                          <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg p-1 min-w-[140px] font-normal normal-case">
                            {["All", "Active", "Inactive"].map(opt => (
                              <div key={opt} onClick={() => { setSupervisorStatusFilter(opt); setSupervisorsPage(1); setOpenDropdown(null); }} className="px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-gray-50 flex items-center gap-2">
                                {supervisorStatusFilter === opt ? <div className="w-2 h-2 rounded-full bg-[#1A3C6E]" /> : <div className="w-2 h-2" />}
                                {opt}
                              </div>
                            ))}
                          </div>
                        )}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedSupervisors.length === 0 && <tr><td colSpan="3" className="text-center text-gray-400 py-8">No results match your search</td></tr>}
                    {paginatedSupervisors.map(s => (
                      <tr key={s.id} onClick={() => nav(`/superadmin/supervisors/${s.id}`)}
                        className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors">
                        <td className="px-5 py-3 font-semibold text-[#1A3C6E]">{s.name}</td>
                        <td className="px-5 py-3 text-gray-600">{s.email}</td>
                        <td className="px-5 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${s.is_active ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{s.is_active ? "Active" : "Inactive"}</span>
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
            </div>
          </>
        )}

        {activeTab === "hotels" && p.provider_type === "valet_provider" && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h2 className="font-heading text-lg font-semibold text-[#0F2044]">Hotels</h2>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full sm:w-64">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={hotelSearch} onChange={e => { setHotelSearch(e.target.value); setHotelsPage(1); }} placeholder="Search by hotel name or city..." className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-[#1A3C6E]" />
                </div>
                <button onClick={() => { setHotelModal(true); setTimeout(() => { const el = document.getElementById('modal-add-hotel'); if (el) el.scrollTop = 0; }, 50); }}
                  className="inline-flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition">
                  <Plus className="w-4 h-4" /> Add Hotel
                </button>
              </div>
            </div>
            {hotelStatusFilter !== "All" && (
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1A3C6E]/10 text-[#1A3C6E] text-xs font-semibold">
                  Status: {hotelStatusFilter} <button onClick={() => { setHotelStatusFilter("All"); setHotelsPage(1); }}>×</button>
                </span>
              </div>
            )}
            <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden mb-6">
              <div className="overflow-x-auto w-full max-w-full">
                <table className="w-full text-sm min-w-[600px]">
                  <thead className="bg-gray-50 text-gray-500 uppercase text-xs tracking-wider">
                    <tr>
                      <th className="text-left px-5 py-3">Hotel Name</th>
                      <th className="text-left px-5 py-3">City</th>
                      <th className="text-left px-5 py-3">Slots</th>
                      <th className="text-left px-5 py-3">Hours</th>
                      <th className="text-left px-5 py-3 relative filter-dropdown-container">
                        <span
                          onClick={() => setOpenDropdown(openDropdown === 'hotelStatus' ? null : 'hotelStatus')}
                          className={`flex items-center gap-1 cursor-pointer select-none ${hotelStatusFilter !== "All" ? "text-[#1A3C6E] font-bold" : ""}`}
                        >
                          STATUS <ChevronDown className={`w-3 h-3 ${hotelStatusFilter !== "All" ? "text-[#1A3C6E]" : ""}`} />
                        </span>
                        {openDropdown === 'hotelStatus' && (
                          <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg p-1 min-w-[140px] font-normal normal-case">
                            {["All", "Active", "Inactive"].map(opt => (
                              <div key={opt} onClick={() => { setHotelStatusFilter(opt); setHotelsPage(1); setOpenDropdown(null); }} className="px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-gray-50 flex items-center gap-2">
                                {hotelStatusFilter === opt ? <div className="w-2 h-2 rounded-full bg-[#1A3C6E]" /> : <div className="w-2 h-2" />}
                                {opt}
                              </div>
                            ))}
                          </div>
                        )}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingHotels ? (
                      <tr><td colSpan="5" className="text-center py-8 text-gray-400">Loading hotels...</td></tr>
                    ) : paginatedHotels.length === 0 ? (
                      <tr><td colSpan="5" className="text-center py-8 text-gray-400">No results match your search</td></tr>
                    ) : (
                      paginatedHotels.map(h => (
                        <tr key={h.id}
                          onClick={() => nav(`/superadmin/valet-provider-hotels/${h.id}`)}
                          className="border-t border-gray-100 hover:bg-[#F4F6FA] cursor-pointer transition-colors group">
                          <td className="px-5 py-3 font-semibold text-[#1A3C6E] group-hover:text-[#0F2044]">{h.name}</td>
                          <td className="px-5 py-3 text-gray-500">{h.city || "—"}</td>
                          <td className="px-5 py-3 text-gray-500">{h.total_valet_slots ?? "—"}</td>
                          <td className="px-5 py-3 text-gray-500">{h.operating_hours_start && h.operating_hours_end ? `${h.operating_hours_start} - ${h.operating_hours_end}` : "—"}</td>
                          <td className="px-5 py-3">
                            <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${h.is_active ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                              {h.is_active ? "Active" : "Inactive"}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                {filteredHotels.length > 10 && (
                  <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between">
                    <span className="text-sm text-gray-400">
                      Showing {Math.min((hotelsPage - 1) * 10 + 1, filteredHotels.length)}–{Math.min(hotelsPage * 10, filteredHotels.length)} of {filteredHotels.length}
                    </span>
                    <div className="flex items-center gap-2">
                      <button disabled={hotelsPage === 1} onClick={() => setHotelsPage(p => p - 1)}
                        className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Prev</button>
                      <span className="px-3 py-1.5 rounded-lg bg-[#0F2044] text-white text-sm font-bold">{hotelsPage}</span>
                      <button disabled={hotelsPage * 10 >= filteredHotels.length} onClick={() => setHotelsPage(p => p + 1)}
                        className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Next</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {activeTab === "cars" && (
          <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-gray-100">
              <h2 className="font-heading text-lg font-bold text-[#0F2044]">Cars Registry
                <span className="ml-2 text-sm font-normal text-gray-400">({filteredCars.length} unique plates)</span>
              </h2>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={carSearch} onChange={e => { setCarSearch(e.target.value); setCarsPage(1); }}
                  placeholder="Search plate or make…"
                  className="pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-[#1A3C6E] w-full sm:w-64" />
              </div>
            </div>
            {loadingCars ? (
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
                    {paginatedCars.length === 0 && (
                      <tr><td colSpan="7" className="text-center text-gray-400 py-12">No cars found</td></tr>
                    )}
                    {paginatedCars.map(c => (
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
            {filteredCars.length > 10 && (
              <div className="px-4 sm:px-6 py-4 border-t border-gray-100 flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-gray-400">Showing {Math.min((carsPage - 1) * 10 + 1, filteredCars.length)}–{Math.min(carsPage * 10, filteredCars.length)} of {filteredCars.length}</span>
                <div className="flex flex-wrap items-center gap-2">
                  <button disabled={carsPage === 1} onClick={() => setCarsPage(p => p - 1)} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Prev</button>
                  <span className="px-3 py-1.5 rounded-lg bg-[#0F2044] text-white text-sm font-bold">{carsPage}</span>
                  <button disabled={carsPage * 10 >= filteredCars.length} onClick={() => setCarsPage(p => p + 1)} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Next</button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "qr_codes" && (
          <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden mb-6">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-gray-100">
              <h2 className="font-heading text-lg font-bold text-[#0F2044]">QR Codes
                <span className="ml-2 text-sm font-normal text-gray-400">({providerQrCards.length} tags)</span>
              </h2>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={qrSearch} onChange={e => setQrSearch(e.target.value)}
                  placeholder="Search by tag number..."
                  className="pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-[#1A3C6E] w-full sm:w-64" />
              </div>
            </div>
            {loadingQrCards ? (
              <div className="py-16 flex justify-center"><div className="w-8 h-8 border-4 border-[#1A3C6E] border-t-transparent rounded-full animate-spin" /></div>
            ) : providerQrCards.length > 0 ? (
              <div className="p-4 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    <select
                      value={selectedQrDate || ""}
                      onChange={(e) => setSelectedQrDate(e.target.value)}
                      className="px-3 py-2 rounded-lg border border-gray-200 outline-none focus:border-[#1A3C6E] text-sm font-bold text-[#0F2044] bg-white"
                    >
                      <option value="all">All ({providerQrCards.length} tag{providerQrCards.length !== 1 ? "s" : ""})</option>
                      {qrGroupsByDate.map(g => (
                        <option key={g.dateKey} value={g.dateKey}>
                          {g.label} ({g.cards.length} tag{g.cards.length !== 1 ? "s" : ""})
                        </option>
                      ))}
                    </select>
                  </div>
                  {selectedQrGroup && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleDownloadDateGroup(selectedQrGroup)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 bg-white hover:bg-gray-50 text-xs font-bold transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" /> Download All
                      </button>
                      <button
                        onClick={() => handleShareDateGroup(selectedQrGroup)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 bg-white hover:bg-gray-50 text-xs font-bold transition-colors"
                      >
                        <Share2 className="w-3.5 h-3.5" /> Share
                      </button>
                    </div>
                  )}
                </div>

                {selectedQrGroup && (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                      {qrVisibleCards.map(c => (
                        <div key={c.id} onClick={() => setQrModalCard(c)} className="bg-white border border-gray-100 rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer hover:shadow-md transition-shadow group relative">
                          {c.status === "pending_incident" && (
                            <div className="absolute top-2 right-2 text-amber-500 bg-amber-50 rounded-full p-1" title="Pending Incident Review">
                              <AlertTriangle className="w-4 h-4" />
                            </div>
                          )}
                          <div className="bg-gray-50 p-2 rounded-lg mb-3 group-hover:scale-105 transition-transform">
                            <QRCodeSVG value={`${API}/qr-redirect/${c.qr_token}`} size={80} />
                          </div>
                          <div className="font-bold text-gray-700 text-sm">Tag #{c.key_tag_number}</div>
                        </div>
                      ))}
                    </div>

                    {qrTotalPages > 1 && (
                      <div className="flex items-center justify-between gap-3 mt-4 pt-4 border-t border-gray-100">
                        <span className="text-xs text-gray-400">
                          Showing {qrVisibleCards.length} of {selectedQrGroup.cards.length} tags
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setQrPage(p => Math.max(1, p - 1))}
                            disabled={qrPage === 1}
                            className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-bold text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            Previous
                          </button>
                          <span className="text-xs text-gray-500 font-medium px-1">Page {qrPage} of {qrTotalPages}</span>
                          <button
                            onClick={() => setQrPage(p => Math.min(qrTotalPages, p + 1))}
                            disabled={qrPage === qrTotalPages}
                            className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-bold text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="w-16 h-16 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-4 text-gray-400"><QrCode className="w-8 h-8" /></div>
                <h3 className="font-heading text-lg font-semibold text-[#0F2044]">No QR Codes Found</h3>
                <p className="text-gray-500 text-sm mt-1">Try adjusting your search criteria.</p>
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
              {liveEvents.length === 0 ? (
                <div className="py-12 text-center text-gray-400 text-sm">No active events right now</div>
              ) : (
                liveEvents.map(e => (
                  <div key={e.id} onClick={() => setSelectedLiveEvent(e)}
                    className={`px-6 py-4 border-b border-gray-50 cursor-pointer transition-colors ${selectedLiveEvent?.id === e.id ? "bg-[#0F2044] text-white" : "hover:bg-[#F4F6FA]"
                      }`}>
                    <div className={`font-semibold text-sm ${selectedLiveEvent?.id === e.id ? "text-white" : "text-[#0F2044]"}`}>{e.name}</div>
                    <div className={`text-xs mt-0.5 ${selectedLiveEvent?.id === e.id ? "text-white/60" : "text-gray-400"}`}>{e.venue} · {e.date}</div>
                  </div>
                ))
              )}
            </div>
            <div className="lg:col-span-2 bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden">
              {!selectedLiveEvent ? (
                <div className="py-24 text-center text-gray-400 text-sm">Select an active event to see its live queue</div>
              ) : (
                <>
                  <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="font-heading text-lg font-bold text-[#0F2044]">{selectedLiveEvent.name}</h3>
                    <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live
                    </span>
                  </div>
                  {loadingQueue ? (
                    <div className="py-16 flex justify-center"><div className="w-8 h-8 border-4 border-[#1A3C6E] border-t-transparent rounded-full animate-spin" /></div>
                  ) : liveQueue.length === 0 ? (
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
                          {liveQueue.map(c => (
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
                <span className="ml-2 text-sm font-normal text-gray-400">({filteredIncidents.length} total)</span>
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
                      <th className="text-left px-6 py-3">Driver</th>
                      <th className="text-left px-6 py-3">Date</th>
                      <th className="text-left px-6 py-3">Status</th>
                      <th className="text-left px-6 py-3">Remark</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedIncidents.length === 0 && (
                      <tr><td colSpan="8" className="text-center text-gray-400 py-12">No incidents found</td></tr>
                    )}
                    {paginatedIncidents.map((inc, i) => (
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
            {filteredIncidents.length > 10 && (
              <div className="px-4 sm:px-6 py-4 border-t border-gray-100 flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-gray-400">Showing {Math.min((incidentsPage - 1) * 10 + 1, filteredIncidents.length)}–{Math.min(incidentsPage * 10, filteredIncidents.length)} of {filteredIncidents.length}</span>
                <div className="flex flex-wrap items-center gap-2">
                  <button disabled={incidentsPage === 1} onClick={() => setIncidentsPage(p => p - 1)} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Prev</button>
                  <span className="px-3 py-1.5 rounded-lg bg-[#0F2044] text-white text-sm font-bold">{incidentsPage}</span>
                  <button disabled={incidentsPage * 10 >= filteredIncidents.length} onClick={() => setIncidentsPage(p => p + 1)} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Next</button>
                </div>
              </div>
            )}
          </div>
        )}

      </div>

      {/* MODALS */}
      {showModal && (
        <div id="modal-create-event" className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-8 bg-black/50 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col animate-in fade-in zoom-in duration-200 mb-8">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
              <h3 className="font-heading text-xl font-bold text-[#0F2044]">Create New Event</h3>
              <button onClick={() => { setShowModal(false); setForm({ name: "", date: "", end_date: "", venue: "", max_cars: 50, gate_timer_minutes: 5, allow_instant_park: false, start_time: "00:00", end_time: "23:59", gates: "Main Gate", zones: [{ name: "A", slots: 20 }] }); }} className="text-gray-400 hover:text-gray-600">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="px-6 py-4">
              <form onSubmit={handleCreateEvent} className="space-y-4">
                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Event Name <span className="text-red-500">*</span></label>
                    <input type="text" value={form.name} onChange={e => { setForm({ ...form, name: e.target.value }); if (errors.name) setErrors(prev => ({ ...prev, name: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${errors.name ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`} />
                    {errors.name && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.name}</p>}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Start Date <span className="text-red-500">*</span></label>
                      <input type="date" value={form.date} onChange={e => { setForm({ ...form, date: e.target.value }); if (errors.date) setErrors(prev => ({ ...prev, date: undefined })); }}
                        className={`w-full px-4 py-2 rounded-xl border ${errors.date ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`} />
                      {errors.date && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.date}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">End Date <span className="text-red-500">*</span></label>
                      <input type="date" value={form.end_date} onChange={e => { setForm({ ...form, end_date: e.target.value }); if (errors.end_date) setErrors(prev => ({ ...prev, end_date: undefined })); }}
                        className={`w-full px-4 py-2 rounded-xl border ${errors.end_date ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`} />
                      {errors.end_date && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.end_date}</p>}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Venue <span className="text-red-500">*</span></label>
                    <input type="text" value={form.venue} onChange={e => { setForm({ ...form, venue: e.target.value }); if (errors.venue) setErrors(prev => ({ ...prev, venue: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${errors.venue ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`} />
                    {errors.venue && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.venue}</p>}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Max Cars <span className="text-red-500">*</span></label>
                      <input type="number" value={form.max_cars} onChange={e => { setForm({ ...form, max_cars: parseInt(e.target.value) }); if (errors.max_cars) setErrors(prev => ({ ...prev, max_cars: undefined })); }}
                        className={`w-full px-4 py-2 rounded-xl border ${errors.max_cars ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`} />
                      {errors.max_cars && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.max_cars}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Gate Timer (min)</label>
                      <input type="number" min="1" max="30" value={form.gate_timer_minutes} onChange={e => { setForm({ ...form, gate_timer_minutes: e.target.value }); if (errors.gate_timer_minutes) setErrors(prev => ({ ...prev, gate_timer_minutes: undefined })); }}
                        className={`w-full px-4 py-2 rounded-xl border ${errors.gate_timer_minutes ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`} />
                      {errors.gate_timer_minutes && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.gate_timer_minutes}</p>}
                    </div>
                    <div className="flex items-center gap-2 mt-4 sm:col-span-2">
                      <input type="checkbox" id="allow_instant_park_vp" checked={form.allow_instant_park}
                        onChange={(e) => setForm({ ...form, allow_instant_park: e.target.checked })}
                        className="w-4 h-4 text-[#1A3C6E] bg-gray-100 border-gray-300 rounded focus:ring-[#1A3C6E]" />
                      <label htmlFor="allow_instant_park_vp" className="text-xs font-semibold text-gray-600 uppercase cursor-pointer">
                        Allow Instant Park for this event
                      </label>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Start Time <span className="text-red-500">*</span></label>
                      <input type="time" value={form.start_time} onChange={e => { setForm({ ...form, start_time: e.target.value }); if (errors.start_time) setErrors(prev => ({ ...prev, start_time: undefined })); }}
                        className={`w-full px-4 py-2 rounded-xl border ${errors.start_time ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`} />
                      {errors.start_time && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.start_time}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">End Time <span className="text-red-500">*</span></label>
                      <input type="time" value={form.end_time} onChange={e => { setForm({ ...form, end_time: e.target.value }); if (errors.end_time) setErrors(prev => ({ ...prev, end_time: undefined })); }}
                        className={`w-full px-4 py-2 rounded-xl border ${errors.end_time ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`} />
                      {errors.end_time && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.end_time}</p>}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Gates (comma separated)</label>
                    <input type="text" placeholder="Main Gate, VIP, South" value={form.gates} onChange={e => { setForm({ ...form, gates: e.target.value }); if (errors.gates) setErrors(prev => ({ ...prev, gates: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${errors.gates ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`} />
                    {errors.gates && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.gates}</p>}
                  </div>

                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">
                        Parking Zones
                      </label>
                      <span className={`text-xs font-bold ${totalSlots > form.max_cars ? "text-red-500" : "text-emerald-600"}`}>
                        {totalSlots} / {form.max_cars} slots
                      </span>
                    </div>
                    <div className="space-y-2 mb-2">
                      {form.zones.map((z, i) => (
                        <div key={i} className="flex gap-2 items-center">
                          <input
                            type="text"
                            placeholder="Zone name (e.g. A)"
                            value={z.name}
                            onChange={e => {
                              const zones = [...form.zones];
                              zones[i] = { ...zones[i], name: e.target.value };
                              setForm({ ...form, zones });
                            }}
                            className="flex-1 px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:border-[#1A3C6E] text-sm"
                          />
                          <input
                            type="number"
                            placeholder="Slots"
                            value={z.slots}
                            min={1}
                            onChange={e => {
                              const zones = [...form.zones];
                              zones[i] = { ...zones[i], slots: parseInt(e.target.value) || 0 };
                              setForm({ ...form, zones });
                            }}
                            className="w-20 px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:border-[#1A3C6E] text-sm text-center"
                          />
                          <button type="button"
                            onClick={() => setForm({ ...form, zones: form.zones.filter((_, k) => k !== i) })}
                            className="text-red-400 hover:text-red-600 font-bold text-lg leading-none px-1">
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    <button type="button"
                      onClick={() => setForm({ ...form, zones: [...form.zones, { name: "", slots: 10 }] })}
                      className="w-full py-2 rounded-xl border border-dashed border-[#1A3C6E] text-[#1A3C6E] text-sm font-semibold hover:bg-blue-50 transition">
                      + Add Zone
                    </button>
                  </div>
                </div>

                <p className="text-xs text-gray-400 mb-2"><span className="text-red-500">*</span> Required fields</p>
                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => setShowModal(false)}
                    className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-semibold hover:bg-gray-50 transition">
                    Cancel
                  </button>
                  <button type="submit"
                    className="flex-1 px-4 py-2.5 rounded-xl bg-[#1A3C6E] text-white font-semibold hover:bg-[#0F2044] transition">
                    Create Event
                  </button>
                </div>
              </form>
            </div>
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
                        <span className="text-3xl">🧑</span>
                      )}
                    </div>
                    {driverPhotoPreview && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDriverPhotoPreview(null);
                          setDriverPhotoFile(null);
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
                    <input type="text" value={driverForm.name}
                      onChange={e => { setDriverForm({ ...driverForm, name: e.target.value }); if (driverErrors.name) setDriverErrors(prev => ({ ...prev, name: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${driverErrors.name ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`} />
                    {driverErrors.name && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.name}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Phone <span className="text-red-500">*</span></label>
                    <input type="tel" inputMode="numeric" value={driverForm.phone}
                      onChange={e => { setDriverForm({ ...driverForm, phone: e.target.value.replace(/\D/g, "").slice(0, 10) }); if (driverErrors.phone) setDriverErrors(prev => ({ ...prev, phone: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${driverErrors.phone ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`} />
                    {driverErrors.phone && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.phone}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">4-Digit PIN <span className="text-red-500">*</span></label>
                    <input type="text" value={driverForm.pin}
                      onChange={e => { setDriverForm({ ...driverForm, pin: e.target.value.replace(/\D/g, "").slice(0, 4) }); if (driverErrors.pin) setDriverErrors(prev => ({ ...prev, pin: undefined })); }}
                      placeholder="e.g. 1234"
                      className={`w-full px-4 py-2 rounded-xl border ${driverErrors.pin ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E] font-mono tracking-widest`} />
                    {driverErrors.pin && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.pin}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                      Email <span className="text-red-500">*</span>
                    </label>
                    <input type="email" value={driverForm.email}
                      onChange={e => { setDriverForm({ ...driverForm, email: e.target.value }); if (driverErrors.email) setDriverErrors(prev => ({ ...prev, email: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${driverErrors.email ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`} />
                    {driverErrors.email && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.email}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Gender <span className="text-red-500">*</span></label>
                    <select value={driverForm.gender}
                      onChange={e => { setDriverForm({ ...driverForm, gender: e.target.value }); if (driverErrors.gender) setDriverErrors(prev => ({ ...prev, gender: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${driverErrors.gender ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`}>
                      <option value="" disabled>Select gender</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                    {driverErrors.gender && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.gender}</p>}
                  </div>
                </div>

                <div className="border-t border-gray-100 my-2" />
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">
                  Documents
                </p>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">PAN Card Number</label>
                    <input type="text" placeholder="ABCDE1234F" value={driverForm.pan_number}
                      onChange={e => { setDriverForm({ ...driverForm, pan_number: e.target.value.toUpperCase().slice(0, 10) }); if (driverErrors.pan_number) setDriverErrors(prev => ({ ...prev, pan_number: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${driverErrors.pan_number ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E] font-mono`} />
                    {driverErrors.pan_number && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.pan_number}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Bank Account Number</label>
                    <input type="text" inputMode="numeric" value={driverForm.bank_account_number}
                      onChange={e => { setDriverForm({ ...driverForm, bank_account_number: e.target.value.replace(/\D/g, "").slice(0, 18) }); if (driverErrors.bank_account_number) setDriverErrors(prev => ({ ...prev, bank_account_number: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${driverErrors.bank_account_number ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`} />
                    {driverErrors.bank_account_number && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.bank_account_number}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Bank IFSC Code</label>
                    <input type="text" placeholder="SBIN0001234" value={driverForm.bank_ifsc}
                      onChange={e => { setDriverForm({ ...driverForm, bank_ifsc: e.target.value.toUpperCase().slice(0, 11) }); if (driverErrors.bank_ifsc) setDriverErrors(prev => ({ ...prev, bank_ifsc: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${driverErrors.bank_ifsc ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E] font-mono`} />
                    {driverErrors.bank_ifsc && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.bank_ifsc}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Driving License Number <span className="text-red-500">*</span></label>
                    <input type="text" inputMode="text" value={driverForm.driving_license_number}
                      onChange={e => { setDriverForm({ ...driverForm, driving_license_number: e.target.value.toUpperCase().slice(0, 16) }); if (driverErrors.driving_license_number) setDriverErrors(prev => ({ ...prev, driving_license_number: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${driverErrors.driving_license_number ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E] font-mono`} />
                    {driverErrors.driving_license_number && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.driving_license_number}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Aadhar Number <span className="text-red-500">*</span></label>
                    <input type="text" inputMode="numeric" value={driverForm.aadhar_number}
                      onChange={e => { setDriverForm({ ...driverForm, aadhar_number: e.target.value.replace(/\D/g, "").slice(0, 12) }); if (driverErrors.aadhar_number) setDriverErrors(prev => ({ ...prev, aadhar_number: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${driverErrors.aadhar_number ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`} />
                    {driverErrors.aadhar_number && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.aadhar_number}</p>}
                  </div>
                  <div />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                    Driving License Photo <span className="text-red-500">*</span>
                  </label>
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
                          <span className="text-2xl mb-1">💳</span>
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
                          setLicensePhotoFile(null);
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

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                    Aadhar Photo <span className="text-red-500">*</span>
                  </label>
                  <div className="relative group">
                    <div
                      onClick={() => document.getElementById("drv-aadhar-photo-input").click()}
                      className={`w-full border-2 border-dashed ${driverErrors.drvAadharPhoto ? "border-red-400" : "border-gray-200"} rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer hover:border-[#1A3C6E] transition`}
                    >
                      {drvAadharPhotoPreview ? (
                        <img src={drvAadharPhotoPreview} alt="Aadhar"
                          className="h-24 w-full object-cover rounded-lg" />
                      ) : (
                        <>
                          <span className="text-2xl mb-1">📄</span>
                          <span className="text-xs text-gray-400">Click to upload aadhar photo</span>
                        </>
                      )}
                    </div>
                    {drvAadharPhotoPreview && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDrvAadharPhotoPreview(null);
                          setDrvAadharPhotoFile(null);
                        }}
                        className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-400 hover:text-red-500 hover:border-red-200 transition-all z-10"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <input
                    id="drv-aadhar-photo-input"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => { handleDriverAadharPhoto(e); if (driverErrors.drvAadharPhoto) setDriverErrors(prev => ({ ...prev, drvAadharPhoto: undefined })); }}
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
                        <span className="text-3xl">🧑‍💼</span>
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
                    <input type="text" value={supervisorForm.name}
                      onChange={e => { setSupervisorForm({ ...supervisorForm, name: e.target.value }); if (supervisorErrors.name) setSupervisorErrors(prev => ({ ...prev, name: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${supervisorErrors.name ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`} />
                    {supervisorErrors.name && <p className="text-[11px] text-red-500 mt-1 font-medium">* {supervisorErrors.name}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Phone Number <span className="text-red-500">*</span></label>
                    <input type="tel" inputMode="numeric" value={supervisorForm.phone}
                      onChange={e => { setSupervisorForm({ ...supervisorForm, phone: e.target.value.replace(/\D/g, "").slice(0, 10) }); if (supervisorErrors.phone) setSupervisorErrors(prev => ({ ...prev, phone: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${supervisorErrors.phone ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`} />
                    {supervisorErrors.phone && <p className="text-[11px] text-red-500 mt-1 font-medium">* {supervisorErrors.phone}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Email <span className="text-red-500">*</span></label>
                    <input type="email" value={supervisorForm.email}
                      name="new-supervisor-email" autoComplete="off"
                      onChange={e => { setSupervisorForm({ ...supervisorForm, email: e.target.value }); if (supervisorErrors.email) setSupervisorErrors(prev => ({ ...prev, email: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${supervisorErrors.email ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`} />
                    {supervisorErrors.email && <p className="text-[11px] text-red-500 mt-1 font-medium">* {supervisorErrors.email}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Gender <span className="text-red-500">*</span></label>
                    <select value={supervisorForm.gender}
                      onChange={e => { setSupervisorForm({ ...supervisorForm, gender: e.target.value }); if (supervisorErrors.gender) setSupervisorErrors(prev => ({ ...prev, gender: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${supervisorErrors.gender ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`}>
                      <option value="" disabled>Select gender</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                    {supervisorErrors.gender && <p className="text-[11px] text-red-500 mt-1 font-medium">* {supervisorErrors.gender}</p>}
                  </div>
                </div>
                {/* <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Password <span className="text-red-500">*</span></label>
                    <input type="password" value={supervisorForm.password}
                      name="new-supervisor-password" autoComplete="new-password"
                      onChange={e => { setSupervisorForm({ ...supervisorForm, password: e.target.value}); if (supervisorErrors.password) setSupervisorErrors(prev => ({ ...prev, password: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${supervisorErrors.password ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`} />
{ supervisorErrors.password && <p className="text-[11px] text-red-500 mt-1 font-medium">* {supervisorErrors.password}</p> }
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Confirm <span className="text-red-500">*</span></label>
                    <input type="password" value={supervisorForm.confirmPassword}
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
                    <input type="text" placeholder="ABCDE1234F" value={supervisorForm.pan_number}
                      onChange={e => { setSupervisorForm({ ...supervisorForm, pan_number: e.target.value.toUpperCase().slice(0, 10) }); if (supervisorErrors.pan_number) setSupervisorErrors(prev => ({ ...prev, pan_number: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${supervisorErrors.pan_number ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E] font-mono`} />
                    {supervisorErrors.pan_number && <p className="text-[11px] text-red-500 mt-1 font-medium">* {supervisorErrors.pan_number}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Bank Account Number</label>
                    <input type="text" inputMode="numeric" value={supervisorForm.bank_account_number}
                      onChange={e => { setSupervisorForm({ ...supervisorForm, bank_account_number: e.target.value.replace(/\D/g, "").slice(0, 18) }); if (supervisorErrors.bank_account_number) setSupervisorErrors(prev => ({ ...prev, bank_account_number: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${supervisorErrors.bank_account_number ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`} />
                    {supervisorErrors.bank_account_number && <p className="text-[11px] text-red-500 mt-1 font-medium">* {supervisorErrors.bank_account_number}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Bank IFSC Code</label>
                    <input type="text" placeholder="SBIN0001234" value={supervisorForm.bank_ifsc}
                      onChange={e => { setSupervisorForm({ ...supervisorForm, bank_ifsc: e.target.value.toUpperCase().slice(0, 11) }); if (supervisorErrors.bank_ifsc) setSupervisorErrors(prev => ({ ...prev, bank_ifsc: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${supervisorErrors.bank_ifsc ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E] font-mono`} />
                    {supervisorErrors.bank_ifsc && <p className="text-[11px] text-red-500 mt-1 font-medium">* {supervisorErrors.bank_ifsc}</p>}
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Aadhar Number <span className="text-red-500">*</span></label>
                    <input type="text" inputMode="numeric" value={supervisorForm.aadhar_number}
                      onChange={e => { setSupervisorForm({ ...supervisorForm, aadhar_number: e.target.value.replace(/\D/g, "").slice(0, 12) }); if (supervisorErrors.aadhar_number) setSupervisorErrors(prev => ({ ...prev, aadhar_number: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${supervisorErrors.aadhar_number ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`} />
                    {supervisorErrors.aadhar_number && <p className="text-[11px] text-red-500 mt-1 font-medium">* {supervisorErrors.aadhar_number}</p>}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                    Aadhar Photo <span className="text-red-500">*</span>
                  </label>
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
                          <span className="text-2xl mb-1">📄</span>
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
                          setSupAadharPhotoFile(null);
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


      {hotelModal && createPortal(
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center overflow-y-auto pt-8 pb-8" onClick={() => setHotelModal(false)}>
          <div
            className="relative bg-white rounded-2xl shadow-2xl max-w-xl w-full mx-4 animate-in fade-in slide-in-from-top-4 duration-300 flex flex-col mb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
              <h3 className="font-heading text-xl font-bold text-[#0F2044]">Add New Hotel</h3>
              <button type="button" onClick={() => setHotelModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-6 h-6" />
              </button>
            </div>
            <form onSubmit={submitHotel} className="px-6 py-4">

              <div className="space-y-4">
                {/* Hotel Photo */}
                <div className="flex flex-col items-center mb-6">
                  <div className="relative group">
                    <label className="cursor-pointer flex flex-col items-center gap-2">
                      <div className="w-24 h-24 rounded-2xl bg-gray-50 border-2 border-dashed border-gray-200 flex items-center justify-center overflow-hidden group-hover:border-[#1A3C6E] transition-colors">
                        {hotelForm.hotel_photo ? (
                          <img src={hotelForm.hotel_photo} className="w-full h-full object-cover" alt="Hotel" />
                        ) : (
                          <Camera className="w-8 h-8 text-gray-300 group-hover:text-[#1A3C6E] transition-colors" />
                        )}
                      </div>
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                        {uploadingHotelPhoto ? "Uploading..." : "Hotel Photo"}
                      </span>
                      <input type="file" className="hidden" accept="image/*" onChange={handleHotelPhotoUpload} disabled={uploadingHotelPhoto} />
                    </label>
                    {hotelForm.hotel_photo && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setHotelForm(prev => ({ ...prev, hotel_photo: null }));
                        }}
                        className="absolute top-0 right-0 translate-x-2 -translate-y-2 w-6 h-6 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-400 hover:text-red-500 hover:border-red-200 transition-all z-10"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Hotel Name */}
                <div>
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Hotel Name <span className="text-red-500">*</span></label>
                  <input type="text" value={hotelForm.name}
                    onChange={(e) => { setHotelForm({ ...hotelForm, name: e.target.value }); if (hotelErrors.name) setHotelErrors(prev => ({ ...prev, name: undefined })); }}
                    className={`mt-1 w-full px-4 py-2 rounded-xl border ${hotelErrors.name ? "border-red-400" : "border-gray-200"} outline-none focus:border-[#1A3C6E] transition-colors`} />
                  {hotelErrors.name && <p className="text-[11px] text-red-500 mt-1 font-medium">* {hotelErrors.name}</p>}
                </div>

                {/* Address */}
                <div>
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Address <span className="text-red-500">*</span></label>
                  <input type="text" value={hotelForm.address}
                    onChange={(e) => { setHotelForm({ ...hotelForm, address: e.target.value }); if (hotelErrors.address) setHotelErrors(prev => ({ ...prev, address: undefined })); }}
                    className={`mt-1 w-full px-4 py-2 rounded-xl border ${hotelErrors.address ? "border-red-400" : "border-gray-200"} outline-none focus:border-[#1A3C6E] transition-colors`} />
                  {hotelErrors.address && <p className="text-[11px] text-red-500 mt-1 font-medium">* {hotelErrors.address}</p>}
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">State <span className="text-red-500">*</span></label>
                  <select
                    value={hotelForm.state || ""}
                    onChange={e => { setHotelForm(prev => ({ ...prev, state: e.target.value, city: "" })); if (hotelErrors.state) setHotelErrors(prev => ({ ...prev, state: undefined })); }}
                    className={`mt-1 w-full px-4 py-2 rounded-xl border ${hotelErrors.state ? "border-red-400" : "border-gray-200"} outline-none focus:border-[#1A3C6E] transition-colors`}
                  >
                    <option value="">Select State</option>
                    {State.getStatesOfCountry("IN").map(s => (
                      <option key={s.isoCode} value={s.name}>{s.name}</option>
                    ))}
                  </select>
                  {hotelErrors.state && <p className="text-[11px] text-red-500 mt-1 font-medium">* {hotelErrors.state}</p>}
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">City <span className="text-red-500">*</span></label>
                  <select
                    value={hotelForm.city || ""}
                    onChange={e => { setHotelForm(prev => ({ ...prev, city: e.target.value })); if (hotelErrors.city) setHotelErrors(prev => ({ ...prev, city: undefined })); }}
                    disabled={!hotelForm.state}
                    className={`mt-1 w-full px-4 py-2 rounded-xl border ${hotelErrors.city ? "border-red-400" : "border-gray-200"} outline-none focus:border-[#1A3C6E] transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <option value="">Select City</option>
                    {(hotelForm.state
                      ? City.getCitiesOfState("IN", State.getStatesOfCountry("IN").find(s => s.name === hotelForm.state)?.isoCode || "")
                      : []
                    ).map(c => (
                      <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                  {hotelErrors.city && <p className="text-[11px] text-red-500 mt-1 font-medium">* {hotelErrors.city}</p>}
                </div>

                {/* Contact Info */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Contact Person Name <span className="text-red-500">*</span></label>
                    <input type="text" value={hotelForm.contact_person_name}
                      onChange={(e) => { setHotelForm({ ...hotelForm, contact_person_name: e.target.value }); if (hotelErrors.contact_person_name) setHotelErrors(prev => ({ ...prev, contact_person_name: undefined })); }}
                      className={`mt-1 w-full px-4 py-2 rounded-xl border ${hotelErrors.contact_person_name ? "border-red-400" : "border-gray-200"} outline-none focus:border-[#1A3C6E] transition-colors`} />
                    {hotelErrors.contact_person_name && <p className="text-[11px] text-red-500 mt-1 font-medium">* {hotelErrors.contact_person_name}</p>}
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Contact Person Phone <span className="text-red-500">*</span></label>
                    <input type="tel" value={hotelForm.contact_person_phone} inputMode="numeric"
                      onChange={(e) => { setHotelForm({ ...hotelForm, contact_person_phone: e.target.value.replace(/\D/g, "").slice(0, 10) }); if (hotelErrors.contact_person_phone) setHotelErrors(prev => ({ ...prev, contact_person_phone: undefined })); }}
                      className={`mt-1 w-full px-4 py-2 rounded-xl border ${hotelErrors.contact_person_phone ? "border-red-400" : "border-gray-200"} outline-none focus:border-[#1A3C6E] transition-colors`} />
                    {hotelErrors.contact_person_phone && <p className="text-[11px] text-red-500 mt-1 font-medium">* {hotelErrors.contact_person_phone}</p>}
                  </div>
                </div>

                {/* Contact Email */}
                <div>
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Contact Person Email (optional)</label>
                  <input type="email" value={hotelForm.contact_person_email}
                    onChange={(e) => { setHotelForm({ ...hotelForm, contact_person_email: e.target.value }); if (hotelErrors.contact_person_email) setHotelErrors(prev => ({ ...prev, contact_person_email: undefined })); }}
                    className={`mt-1 w-full px-4 py-2 rounded-xl border ${hotelErrors.contact_person_email ? "border-red-400" : "border-gray-200"} outline-none focus:border-[#1A3C6E] transition-colors`} />
                  {hotelErrors.contact_person_email && <p className="text-[11px] text-red-500 mt-1 font-medium">* {hotelErrors.contact_person_email}</p>}
                </div>

                {/* Slots */}
                <div>
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Total Valet Slots <span className="text-red-500">*</span></label>
                  <input type="number" value={hotelForm.total_valet_slots}
                    onChange={(e) => { setHotelForm({ ...hotelForm, total_valet_slots: e.target.value }); if (hotelErrors.total_valet_slots) setHotelErrors(prev => ({ ...prev, total_valet_slots: undefined })); }}
                    className={`mt-1 w-full px-4 py-2 rounded-xl border ${hotelErrors.total_valet_slots ? "border-red-400" : "border-gray-200"} outline-none focus:border-[#1A3C6E] transition-colors`} />
                  {hotelErrors.total_valet_slots && <p className="text-[11px] text-red-500 mt-1 font-medium">* {hotelErrors.total_valet_slots}</p>}
                </div>
                {/* Gate Timer */}
                <div>
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Gate Wait Timer (min)</label>
                  <input type="number" min="1" max="30" value={hotelForm.gate_timer_minutes}
                    onChange={(e) => { setHotelForm({ ...hotelForm, gate_timer_minutes: e.target.value }); if (hotelErrors.gate_timer_minutes) setHotelErrors(prev => ({ ...prev, gate_timer_minutes: undefined })); }}
                    className={`mt-1 w-full px-4 py-2 rounded-xl border ${hotelErrors.gate_timer_minutes ? "border-red-400" : "border-gray-200"} outline-none focus:border-[#1A3C6E] transition-colors`} />
                  {hotelErrors.gate_timer_minutes && <p className="text-[11px] text-red-500 mt-1 font-medium">* {hotelErrors.gate_timer_minutes}</p>}
                </div>

                {/* Gates */}
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Gates</label>
                  </div>
                  <div className="space-y-2 mb-2">
                    {gates.map((gate, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <input
                          type="text"
                          placeholder="Gate name"
                          value={gate}
                          onChange={(e) => {
                            const newGates = [...gates];
                            newGates[i] = e.target.value;
                            setGates(newGates);
                          }}
                          className="flex-1 px-3 py-2 rounded-xl border border-gray-200 outline-none focus:border-[#1A3C6E] text-sm"
                        />
                        <button type="button"
                          onClick={() => {
                            if (gates.length > 1) {
                              setGates(gates.filter((_, idx) => idx !== i));
                            }
                          }}
                          className="text-red-400 hover:text-red-600 font-bold text-lg leading-none px-1">
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <button type="button"
                    onClick={() => setGates([...gates, ""])}
                    className="w-full py-2 rounded-xl border border-dashed border-[#1A3C6E] text-[#1A3C6E] text-sm font-semibold hover:bg-blue-50 transition">
                    + Add Gate
                  </button>
                </div>

                {/* Zones */}
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Parking Zones</label>
                    <span className={`text-xs font-bold ${totalHotelSlots > hotelForm.total_valet_slots ? "text-red-500" : "text-emerald-600"}`}>
                      {totalHotelSlots} / {hotelForm.total_valet_slots || "—"} slots
                    </span>
                  </div>
                  <div className="space-y-2 mb-2">
                    {zones.map((zone, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <input
                          type="text"
                          placeholder="Zone name (e.g. A)"
                          value={zone.name}
                          onChange={(e) => {
                            const newZones = [...zones];
                            newZones[i] = { ...newZones[i], name: e.target.value };
                            setZones(newZones);
                          }}
                          className="flex-1 px-3 py-2 rounded-xl border border-gray-200 outline-none focus:border-[#1A3C6E] text-sm"
                        />
                        <input
                          type="number"
                          placeholder="Slots"
                          value={zone.slots}
                          min={1}
                          onChange={(e) => {
                            const newZones = [...zones];
                            newZones[i] = { ...newZones[i], slots: parseInt(e.target.value) || 0 };
                            setZones(newZones);
                          }}
                          className="w-20 px-3 py-2 rounded-xl border border-gray-200 outline-none focus:border-[#1A3C6E] text-sm text-center"
                        />
                        <button type="button"
                          onClick={() => setZones(zones.filter((_, idx) => idx !== i))}
                          className="text-red-400 hover:text-red-600 font-bold text-lg leading-none px-1">
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <button type="button"
                    onClick={() => setZones([...zones, { name: "", slots: 10 }])}
                    className="w-full py-2 rounded-xl border border-dashed border-[#1A3C6E] text-[#1A3C6E] text-sm font-semibold hover:bg-blue-50 transition">
                    + Add Zone
                  </button>
                </div>


              </div>


              <p className="text-xs text-gray-400 mb-2"><span className="text-red-500">*</span> Required fields</p>
              <div className="mt-8 flex gap-3">
                <button type="button" onClick={() => setHotelModal(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 font-medium transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={uploadingHotelPhoto || savingHotel}
                  className="flex-1 bg-[#1A3C6E] text-white rounded-xl py-2.5 font-medium hover:bg-[#0F2044] transition-colors shadow-lg shadow-[#1A3C6E]/20">
                  {uploadingHotelPhoto ? "Uploading..." : savingHotel ? "Creating..." : "Create Hotel"}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}


      {/* QR Code Zoom Modal */}
      {qrModalCard && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setQrModalCard(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-100 shrink-0">
              <h3 className="font-heading text-lg font-bold text-[#0F2044]">Tag #{qrModalCard.key_tag_number}</h3>
              <button onClick={() => setQrModalCard(null)} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="overflow-y-auto">
              <div className="p-8 flex flex-col items-center justify-center bg-gray-50">
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                  <QRCodeSVG value={`${API}/qr-redirect/${qrModalCard.qr_token}`} size={200} />
                </div>
                <div className="mt-6 font-bold text-gray-600 text-xl tracking-wider">#{qrModalCard.key_tag_number}</div>
              </div>
              
              <div className="p-4 sm:p-6 border-t border-gray-100 bg-white">
                <h4 className="text-sm font-bold text-[#1A3C6E] mb-3 uppercase tracking-wider">Incident History</h4>
                {loadingQrHistory ? (
                  <div className="flex justify-center py-4"><div className="w-6 h-6 border-2 border-[#1A3C6E] border-t-transparent rounded-full animate-spin" /></div>
                ) : qrIncidentHistory.length === 0 ? (
                  <div className="text-sm text-gray-400 py-4 text-center">No reported incidents for this tag.</div>
                ) : (
                  <div className="space-y-3">
                    {qrIncidentHistory.map(inc => (
                      <div key={inc.id} className="p-3 border border-gray-100 rounded-xl bg-gray-50">
                        <div className="flex justify-between items-start mb-1">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${inc.status === "pending" ? "bg-amber-100 text-amber-700" : inc.status === "approved" ? "bg-emerald-100 text-emerald-700" : "bg-gray-200 text-gray-700"}`}>
                            {inc.status}
                          </span>
                          <span className="text-xs text-gray-400">{new Date(inc.reported_at).toLocaleString()}</span>
                        </div>
                        <p className="text-sm font-bold text-gray-700 capitalize mb-1">Reported {inc.reason}</p>
                        {inc.note && <p className="text-xs text-gray-500">{inc.note}</p>}
                        
                        {inc.status === "pending" && qrModalCard.status === "pending_incident" && (
                          <div className="flex gap-2 mt-3 pt-3 border-t border-gray-200">
                            <button onClick={() => handleApproveIncident(inc.id)} className="flex-1 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 rounded-lg text-xs font-bold transition">
                              Approve (Replace)
                            </button>
                            <button onClick={() => handleRejectIncident(inc.id)} className="flex-1 py-1.5 bg-white text-gray-600 hover:bg-gray-100 border border-gray-200 rounded-lg text-xs font-bold transition">
                              Reject (Restore)
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            
          </div>
        </div>
      )}

    </SuperLayout>
  );
}