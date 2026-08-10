import { useEffect, useState, useMemo, useRef } from 'react';
import { Link, useParams, useNavigate } from "react-router-dom";
import SuperLayout from "@/components/layout/SuperLayout";
import { api, WS_BASE } from "@/lib/api";
import { fmtTime, fmtDate, fmtDateTime, fmtDateTimeFull } from "@/lib/time";
import { toast } from "sonner";
import { ArrowLeft, Calendar, MapPin, Building2, Users, Car, Star, Clock, Info, Search, MessageSquare, FileText, FileSpreadsheet, X, ChevronDown, CheckCircle2, QrCode, Copy, Download, AlertTriangle, CheckCircle, Edit2, ExternalLink, Radio } from "lucide-react";
import StatusBadge from "@/components/ui/StatusBadge";
import { QRCodeSVG } from "qrcode.react";

const INCIDENT_TYPES = [
  { key: "DAMAGE", label: "Damage", icon: "🚗" },
  { key: "THEFT", label: "Theft", icon: "🔓" },
  { key: "WRONG_CAR", label: "Wrong Car", icon: "🔄" },
  { key: "DELAY", label: "Delay", icon: "⏱️" },
  { key: "KEY_LOST", label: "Key Lost", icon: "🔑" },
  { key: "ACCIDENT", label: "Accident", icon: "💥" },
  { key: "MISCONDUCT", label: "Misconduct", icon: "⚠️" },
  { key: "GUEST_COMPLAINT", label: "Guest Complaint", icon: "👤" },
  { key: "OTHER", label: "Other", icon: "📝" },
];

const STATUS_COLORS = {
  OPEN: { bg: "bg-red-100", text: "text-red-700" },
  IN_REVIEW: { bg: "bg-yellow-100", text: "text-yellow-700" },
  RESOLVED: { bg: "bg-green-100", text: "text-green-700" },
  DISMISSED: { bg: "bg-gray-100", text: "text-gray-500" },
};


export default function EventDetail() {
  const { eid } = useParams();
  const nav = useNavigate();
  const [event, setEvent] = useState(null);
  const [cars, setCars] = useState([]);
  const [loading, setLoading] = useState(true);

  const [incidentType, setIncidentType] = useState("");
  const [resolveModal, setResolveModal] = useState(null); // { incident_id, current_status }
  const [resolveStatus, setResolveStatus] = useState("");
  const [resolveRemark, setResolveRemark] = useState("");
  const [resolvingIncident, setResolvingIncident] = useState(false);


  const [selectedDriver, setSelectedDriver] = useState(null);
  const [driverCars, setDriverCars] = useState([]);
  const [carsLoading, setCarsLoading] = useState(false);
  const [expandedCarId, setExpandedCarId] = useState(null);

  const [driversPage, setDriversPage] = useState(1);
  const [driverCarsPage, setDriverCarsPage] = useState(1);
  const [incidentsPage, setIncidentsPage] = useState(1);
  const [incidentSearch, setIncidentSearch] = useState("");
  const [supervisorsPage, setSupervisorsPage] = useState(1);

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "", venue: "", date: "", end_date: "",
    start_time: "", end_time: "", max_cars: "", gate_timer_minutes: "",
    key_hook_start: 1, key_hook_end: 50, zones: [], gates: [],
    allow_instant_park: false
  });
  const [editErrors, setEditErrors] = useState({});

  const [driverSearch, setDriverSearch] = useState("");
  const [carSearch, setCarSearch] = useState("");
  const [carStatusFilter, setCarStatusFilter] = useState("all");
  const [openDropdown, setOpenDropdown] = useState(null);

  const [eventLiveQueue, setEventLiveQueue] = useState([]);
  const [loadingLiveQueue, setLoadingLiveQueue] = useState(false);

  const [activeTab, setActiveTab] = useState("info");

  const [supervisors, setSupervisors] = useState([]);
  const [supervisorSearch, setSupervisorSearch] = useState("");
  const [drivers, setDrivers] = useState([]);
  const [driversLoading, setDriversLoading] = useState(false);

  useEffect(() => { setDriversPage(1); }, [driverSearch]);
  useEffect(() => { setSupervisorsPage(1); }, [supervisorSearch]);

  const [supsLoading, setSupsLoading] = useState(false);
  const [eventQrToken, setEventQrToken] = useState(null);
  const [wsConnected, setWsConnected] = useState(true);
  const [wsFailed, setWsFailed] = useState(false);
  const [incidents, setIncidents] = useState([]);
  const isClosed = event?.status === "closed";
  const [showQRModal, setShowQRModal] = useState(false);

  const [guestCount, setGuestCount] = useState(0);

  const [feedback, setFeedback] = useState([]);
  const [loadingFeedback, setLoadingFeedback] = useState(false);
  const load = async () => {
    try {
      const [resDetail, resCars, resIncidents, resGuestCount] = await Promise.all([
        api.get(`/superadmin/events/${eid}/detail`),
        api.get(`/superadmin/events/${eid}/cars`),
        api.get(`/incidents/event/${eid}`).catch(() => ({ data: [] })),
        api.get(`/events/${eid}/guest-count`).catch(() => ({ data: { count: 0 } }))
      ]);
      setEvent(resDetail.data);
      setCars(resCars.data);
      setGuestCount(resGuestCount.data.count || 0);
      setSupervisors(resDetail.data.supervisors || []);
      refreshDrivers();
      if (!resDetail.data) throw new Error("Event not found");
      setIncidents(resIncidents.data);
      const e = resDetail.data;
      setEditForm({
        name: e.name || "",
        venue: e.venue || "",
        date: e.date || "",
        end_date: e.end_date || e.date || "",
        start_time: e.start_time || "",
        end_time: e.end_time || "",
        max_cars: e.max_cars || "",
        gate_timer_minutes: e.gate_timer_minutes || 5,
        key_hook_start: e.key_hook_start || 1,
        key_hook_end: e.key_hook_end || (e.key_hooks || 50),
        zones: e.zones || [],
        gates: e.gates ? e.gates.join(", ") : "",
        allow_instant_park: !!e.allow_instant_park
      });
    } catch (err) {
      toast.error("Failed to load event details");
    } finally {
      setLoading(false);
    }
  };



    useEffect(() => {
    if (activeTab !== "feedback" || !event) return;
    if (feedback.length === 0) setLoadingFeedback(true);
    api.get(`/events/${eid}/feedback`)
      .then(r => setFeedback(r.data))
      .catch(() => { })
      .finally(() => setLoadingFeedback(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, eid, event?.id]);

  useEffect(() => {
    if (activeTab !== "queue" || !event) return;
    if (eventLiveQueue.length === 0) setLoadingLiveQueue(true);
    api.get(`/events/${eid}/queue`)
      .then(r => setEventLiveQueue(r.data))
      .catch(() => { })
      .finally(() => setLoadingLiveQueue(false));
    const interval = setInterval(() => {
      api.get(`/events/${eid}/queue`).then(r => setEventLiveQueue(r.data)).catch(() => { });
    }, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, eid, event?.id]);

  useEffect(() => {
    if (event && event.status !== "active" && activeTab === "queue") {
      setActiveTab("info");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.status, activeTab]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest('.filter-dropdown-container')) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!editOpen && !showQRModal) return;
    const handleEsc = (e) => {
      if (e.key === "Escape") {
        if (showQRModal) setShowQRModal(false);
        else if (editOpen) setEditOpen(false); setEditErrors({});
      }
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [editOpen, showQRModal]);

    const validateEdit = () => {
    const errs = {};
    if (!editForm.name?.trim()) errs.name = "Event name cannot be empty";
    if (!editForm.venue?.trim()) errs.venue = "Venue cannot be empty";
    if (!editForm.date?.trim()) errs.date = "Date is required";
    if (!editForm.max_cars || parseInt(editForm.max_cars) < 1) errs.max_cars = "Max cars must be at least 1";
    if (totalSlots > editForm.max_cars) {
      errs.max_cars = `Total slots (${totalSlots}) cannot exceed max cars (${editForm.max_cars}). Reduce zone slots.`;
    }
    return errs;
  };

  const handleEditEvent = async (e) => {
    e.preventDefault();
    const errs = validateEdit();
    setEditErrors(errs);
    if (Object.keys(errs).length > 0) return;
    try {
      const body = {
        ...editForm,
        gate_timer_minutes: editForm.gate_timer_minutes ? parseInt(editForm.gate_timer_minutes) : null,
        key_hook_start: parseInt(editForm.key_hook_start),
        key_hook_end: parseInt(editForm.key_hook_end),
        key_hooks: parseInt(editForm.key_hook_end) - parseInt(editForm.key_hook_start) + 1,
        zones: editForm.zones.filter(z => z.name.trim()),
        gates: editForm.gates.split(",").map(g => g.trim()).filter(g => g)
      };
      await api.patch(`/events/${eid}`, body);
      toast.success("Event updated successfully");
      setEditOpen(false); setEditErrors({});
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to update event");
    }
  };

  const refreshDrivers = async () => {
    setDriversLoading(true);
    try {
      const { data } = await api.get(`/events/${eid}/drivers`);
      setDrivers(data);
    } catch {
      toast.error("Failed to refresh drivers");
    } finally {
      setDriversLoading(false);
    }
  };

  const handleAssignDriver = async (did) => {
    try {
      await api.post(`/events/${eid}/drivers/${did}`);
      toast.success("Driver assigned");
      refreshDrivers();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to assign driver");
    }
  };

  const handleUnassignDriver = async (did) => {
    try {
      await api.delete(`/events/${eid}/drivers/${did}`);
      toast.success("Driver unassigned");
      refreshDrivers();
    } catch (err) {
      toast.error("Failed to unassign driver");
    }
  };

  const refreshSupervisors = async () => {
    setSupsLoading(true);
    try {
      const { data } = await api.get(`/events/${eid}/supervisors`);
      setSupervisors(data);
    } catch {
      toast.error("Failed to refresh supervisors");
    } finally {
      setSupsLoading(false);
    }
  };

  const handleAssignSupervisor = async (sid) => {
    try {
      await api.post(`/events/${eid}/supervisors/${sid}`);
      toast.success("Supervisor assigned");
      refreshSupervisors();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to assign supervisor");
    }
  };

  const handleUnassignSupervisor = async (sid) => {
    try {
      await api.delete(`/events/${eid}/supervisors/${sid}`);
      toast.success("Supervisor unassigned");
      refreshSupervisors();
    } catch {
      toast.error("Failed to unassign supervisor");
    }
  };

  const handleDriverClick = async (driver) => {
    setSelectedDriver(driver);
    setCarsLoading(true);
    try {
      const { data } = await api.get(`/drivers/${driver.id}/events/${eid}/cars`);
      setDriverCars(data);
    } catch {
      toast.error("Failed to load car details");
    } finally {
      setCarsLoading(false);
    }
  };

  const handleResendSms = async (car) => {
    if (!car.guest_phone) return;
    try {
      await api.post(`/cars/${car.id}/send-sms`);
      toast.success(`SMS resent to ${car.guest_phone}`);
    } catch (err) {
      const msg = err.response?.data?.detail || "Failed to send SMS";
      toast.error(typeof msg === "string" ? msg : "Failed to send SMS");
    }
  };

  const handleCloseEvent = async () => {
    if (!window.confirm("Are you sure you want to close this event? This cannot be undone.")) return;
    try {
      await api.post(`/events/${eid}/close`);
      toast.success("Event closed successfully");
      load(); // reload the event data 
    } catch {
      toast.error("Failed to close event");
    }
  };

  const generateCSV = async () => {
    try {
      const { data } = await api.get(`/events/${eid}/report`);
      const headers = [
        "Plate", "Make", "Color", "Status", "Gate", "Zone", "Slot",
        "Key Tag", "Guest Name", "Guest Phone", "Check-in Time",
        "Parked At", "Delivered At", "Duration (min)",
        "Retrieval Time (min)", "Check-in Driver", "Parked Driver",
        "Retrieval Driver", "Platform Rating", "Notes",
        "Pre-registered", "Walk-in", "Peak Hour", "Still Parked"
      ].join(",");
      const rows = data.cars.map(c =>
        [
          c.plate, c.make, c.color, c.status, c.gate,
          c.zone, c.slot, c.key_tag, c.guest_name,
          c.guest_phone, c.check_in_time, c.parked_at,
          c.delivered_at, c.duration_minutes,
          c.retrieval_minutes, c.check_in_driver,
          c.parked_driver, c.retrieval_driver, c.rating,
          `"${(c.notes || "").replace(/"/g, "'")}"`,
          data.summary.pre_registered || 0,
          data.summary.walk_in || 0,
          data.summary.peak_hour || "—",
          data.summary.still_parked || 0,
        ].join(",")
      );
      const csv = [headers, ...rows].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${data.event.name.replace(/\s+/g, "_")}_report.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("CSV downloaded");
    } catch (err) {
      if (err.response?.status === 403) toast.error("Access denied — you can only export reports for your own events");
      else if (err.response?.status === 404) toast.error("Event not found");
      else toast.error("Failed to generate report — please try again");
    }
  };

  const generatePDF = async () => {
    try {
      const { data } = await api.get(`/events/${eid}/report`);
      const e = data.event;
      const s = data.summary;

      const rows = data.cars.map(c => `
        <tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:8px 10px;font-weight:700;">
            ${c.plate}
          </td>
          <td style="padding:8px 10px;">
            ${c.color} ${c.make}
          </td>
          <td style="padding:8px 10px;">${c.status}</td>
          <td style="padding:8px 10px;">
            ${c.check_in_driver || "—"}
          </td>
          <td style="padding:8px 10px;">
            ${c.retrieval_driver || "—"}
          </td>
          <td style="padding:8px 10px;">
            ${c.duration_minutes
          ? c.duration_minutes + " min" : "—"}
          </td>
          <td style="padding:8px 10px;">
            ${c.rating ? "⭐".repeat(c.rating) : "—"}
          </td>
          <td style="padding:8px 10px;font-size:11px;">
            ${c.notes || "—"}
          </td>
        </tr>`
      ).join("");

      const driverRows = data.drivers.map(d => `
        <tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:8px 10px;font-weight:700;">
            ${d.name}
          </td>
          <td style="padding:8px 10px;">${d.employee_id}</td>
          <td style="padding:8px 10px;text-align:center;">
            ${d.checkins}
          </td>
          <td style="padding:8px 10px;text-align:center;">
            ${d.retrievals}
          </td>
          <td style="padding:8px 10px;text-align:center;
            color:${d.incidents > 0 ? "#ef4444" : "#6b7280"};">
            ${d.incidents}
          </td>
        </tr>`
      ).join("");

      const incidentRows = incidents.length > 0
        ? incidents.map(i => `
          <tr style="border-bottom:1px solid #f3f4f6;">
            <td style="padding:8px 10px;font-weight:700;">
              ${i.plate}
            </td>
            <td style="padding:8px 10px;">
              ${i.reported_by || "—"}
            </td>
            <td style="padding:8px 10px;">${i.description}</td>
            <td style="padding:8px 10px;font-size:11px;
              color:#6b7280;">
              ${fmtDateTimeFull(i.created_at)}
            </td>
          </tr>`
        ).join("")
        : `<tr><td colspan="4" style="padding:16px;
            text-align:center;color:#9ca3af;">
            No incidents reported
          </td></tr>`;

      const html = `<!DOCTYPE html><html><head>
        <meta charset="UTF-8">
        <title>${e.name} — Event Report</title>
        <style>
          *{margin:0;padding:0;box-sizing:border-box;}
          body{font-family:Arial,sans-serif;color:#111827;}
          .header{background:#7C3AED;color:white;
            padding:32px 40px;}
          .header h1{font-size:28px;font-weight:900;}
          .header p{opacity:0.8;margin-top:4px;font-size:14px;}
          .section{padding:28px 40px;
            border-bottom:1px solid #f3f4f6;}
          .section h2{font-size:13px;font-weight:800;
            color:#7C3AED;letter-spacing:3px;margin-bottom:16px;}
          .stats-grid{display:grid;
            grid-template-columns:repeat(4,1fr);gap:16px;}
          .stat-card{background:#f9fafb;border-radius:12px;
            padding:16px;text-align:center;}
          .stat-value{font-size:28px;font-weight:900;
            color:#111827;}
          .stat-label{font-size:11px;color:#6b7280;
            margin-top:4px;text-transform:uppercase;
            letter-spacing:1px;}
          table{width:100%;border-collapse:collapse;
            font-size:13px;}
          thead tr{background:#f9fafb;}
          th{padding:10px;text-align:left;font-size:11px;
            text-transform:uppercase;letter-spacing:1px;
            color:#6b7280;font-weight:700;}
          .footer{padding:20px 40px;text-align:center;
            color:#9ca3af;font-size:12px;}
        </style></head><body>
        <div class="header">
          <h1>${e.name}</h1>
          <p>${e.date}
            ${e.start_time
          ? "· " + e.start_time + " to " + e.end_time
          : ""}
            ${e.venue ? "· " + e.venue : ""}
          </p>
          <p style="margin-top:8px;font-size:12px;opacity:0.6;">
            Generated on
            ${fmtDateTimeFull(new Date().toISOString())}
          </p>
        </div>
        <div class="section">
          <h2>EVENT SUMMARY</h2>
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-value">${s.total_cars}</div>
              <div class="stat-label">Total Cars</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">${s.pre_registered || 0}</div>
              <div class="stat-label">Pre-Registered</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">${s.walk_in || 0}</div>
              <div class="stat-label">Walk-in</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">${s.delivered}</div>
              <div class="stat-label">Delivered</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">${s.still_parked || 0}</div>
              <div class="stat-label">Still Parked</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">
                ${s.avg_retrieval_minutes}m
              </div>
              <div class="stat-label">Avg Retrieval</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">
                ${s.platform_avg_rating > 0
          ? s.platform_avg_rating + "★" : "—"}
              </div>
              <div class="stat-label">Platform Rating</div>
            </div>

            <div class="stat-card">
              <div class="stat-value">
                ${s.avg_duration_minutes}m
              </div>
              <div class="stat-label">Avg Duration</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">${s.total_drivers}</div>
              <div class="stat-label">Drivers</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">${s.active}</div>
              <div class="stat-label">Still Active</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">${s.peak_hour || "—"}</div>
              <div class="stat-label">Peak Hour</div>
            </div>
            <div class="stat-card"
              style="color:${s.total_incidents > 0
          ? "#ef4444" : "inherit"}">
              <div class="stat-value">${s.total_incidents}</div>
              <div class="stat-label">Incidents</div>
            </div>
          </div>
        </div>
        <div class="section">
          <h2>DRIVER PERFORMANCE</h2>
          <table><thead><tr>
            <th>Driver</th><th>Employee ID</th>
            <th>Check-ins</th><th>Retrievals</th>
            <th>Incidents</th>
          </tr></thead>
          <tbody>${driverRows}</tbody></table>
        </div>
        <div class="section">
          <h2>INCIDENT REPORTS</h2>
          <table><thead><tr>
            <th>Plate</th><th>Driver</th>
            <th>Description</th><th>Time</th>
          </tr></thead>
          <tbody>${incidentRows}</tbody></table>
        </div>
        <div class="section">
          <h2>CAR DETAILS (${s.total_cars} vehicles)</h2>
          <table><thead><tr>
            <th>Plate</th><th>Vehicle</th><th>Status</th>
            <th>Check-in By</th><th>Retrieved By</th>
            <th>Duration</th><th>Rating</th><th>Notes</th>
          </tr></thead>
          <tbody>${rows}</tbody></table>
        </div>
        <div class="footer">
          InstaPark — Smart Valet Operations · ${e.name}
        </div>
      </body></html>`;

      const w = window.open("", "_blank");
      w.document.write(html);
      w.document.close();
      setTimeout(() => w.print(), 500);
      toast.success("PDF ready to print/save");
    } catch (err) {
      if (err.response?.status === 403) toast.error("Access denied — you can only export reports for your own events");
      else if (err.response?.status === 404) toast.error("Event not found");
      else toast.error("Failed to generate report — please try again");
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [eid]);

  useEffect(() => {
    if (!eid || event?.status === "closed") return;
    let ws, retryCount = 0, retryTimer;
    const connect = () => {
      const token = (api.defaults.headers.common.Authorization || "").replace("Bearer ", "") || localStorage.getItem("superadmin_token");
      ws = new WebSocket(`${WS_BASE}/ws/event/${eid}?token=${token}`);
      ws.onopen = () => { setWsConnected(true); setWsFailed(false); };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "car_update" && msg.data?.id) {
            setCars(prev => {
              const idx = prev.findIndex(c => c.id === msg.data.id);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = { ...next[idx], ...msg.data };
                return next;
              }
              return [...prev, msg.data];
            });
          }
        } catch { }
      };
      ws.onclose = () => {
        setWsConnected(false);
        if (retryCount >= 5) {
          setWsFailed(true);
          return; // Fall back to polling silently after 5 attempts
        }
        const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
        retryCount++;
        retryTimer = setTimeout(connect, delay);
      };
      ws.onerror = () => ws.close();
    };
    connect();
    const poll = setInterval(async () => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        try {
          const { data } = await api.get(`/superadmin/events/${eid}/cars`);
          setCars(data);
        } catch { }
      }
    }, 30000);
    return () => {
      clearTimeout(retryTimer);
      clearInterval(poll);
      ws?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eid]);

  useEffect(() => {
    if (!event) {
      setEventQrToken(null);
      return;
    }
    if (event.event_type === "hotel_special" && event.hotel_id) {
      api.get(`/hotels/${event.hotel_id}/events/${event.id}/qr-token`)
        .then(({ data }) => setEventQrToken(data.event_qr_token))
        .catch(() => {
          toast.error("Failed to load event QR token");
          setEventQrToken(null);
        });
    } else if (!event.event_type || event.event_type === "regular") {
      api.get(`/events/${event.id}/qr-token`)
        .then(({ data }) => setEventQrToken(data.event_qr_token))
        .catch(err => {
          console.error("DEBUG QR Fetch Error:", err, err.response?.status, err.response?.data);
          toast.error("Failed to load event QR token");
          setEventQrToken(null);
        });
    } else {
      setEventQrToken(null);
    }
  }, [event?.id, event?.event_type, event?.hotel_id]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  // const drivers = useMemo(() => event?.drivers || [], [event?.drivers]);

  const filteredDrivers = useMemo(() =>
    drivers.filter(d =>
      !driverSearch || `${d.name} ${d.employee_id}`.toLowerCase().includes(driverSearch.toLowerCase())
    ), [drivers, driverSearch]);

  const filteredSupervisors = useMemo(() =>
    supervisors.filter(s =>
      !supervisorSearch || `${s.name} ${s.email}`.toLowerCase().includes(supervisorSearch.toLowerCase())
    ), [supervisors, supervisorSearch]);

  const filteredCars = useMemo(() =>
    cars.filter(c => {
      const matchQ = !carSearch || `${c.plate} ${c.make} ${c.color} ${c.check_in_driver_name} ${c.retrieval_driver_name}`.toLowerCase().includes(carSearch.toLowerCase());
      const matchStatus = carStatusFilter === "all" || c.status === carStatusFilter;
      return matchQ && matchStatus;
    }), [cars, carSearch, carStatusFilter]);

  const paginatedDrivers = filteredDrivers.slice((driversPage - 1) * 10, driversPage * 10);
  const paginatedDriverCars = driverCars.slice((driverCarsPage - 1) * 10, driverCarsPage * 10);
  const filteredIncidents = useMemo(() =>
    incidents.filter(i =>
      !incidentSearch || i.description?.toLowerCase().includes(incidentSearch.toLowerCase()) ||
      i.plate?.toLowerCase().includes(incidentSearch.toLowerCase())
    ), [incidents, incidentSearch]);
  const paginatedIncidents = filteredIncidents.slice((incidentsPage - 1) * 10, incidentsPage * 10);
  const paginatedSupervisors = filteredSupervisors.slice((supervisorsPage - 1) * 10, supervisorsPage * 10);

  const totalSlots = useMemo(() =>
    editForm.zones.reduce((sum, z) => sum + (parseInt(z.slots) || 0), 0)
    , [editForm.zones]);

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

  if (loading) return (
    <SuperLayout title="Event Detail">
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="w-10 h-10 rounded-full border-4 border-[#1A3C6E] border-t-transparent animate-spin" />
        <p className="text-gray-400 text-sm font-medium">Loading...</p>
      </div>
    </SuperLayout>
  );
  if (!event) return (
    <SuperLayout title="Event Detail">
      <div className="p-8 text-center text-gray-400">Event not found or failed to load.</div>
    </SuperLayout>
  );

  return (
    <SuperLayout title="Event Detail">
      {!wsConnected && !wsFailed && event?.status !== "closed" && (
        <div className="fixed top-2 right-2 bg-yellow-100 text-yellow-800 text-xs px-3 py-2 rounded-lg border border-yellow-300 z-50">
          ⚡ Reconnecting live updates...
        </div>
      )}
      <Link to="/superadmin/events"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-[#1A3C6E] hover:text-[#0F2044] mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Events
      </Link>

      <div className="bg-[#0F2044] rounded-2xl overflow-hidden shadow-card">
        <div className="px-4 sm:px-8 pt-4 sm:pt-8 pb-4 sm:pb-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            {/* LEFT */}
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
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-white/10 text-white/90 border border-white/20 truncate">
                    {event.provider_name || "—"}
                  </span>
                </div>
                <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mt-0.5">{event.venue}</p>
                <p className="text-white/60 text-xs mt-1">{eventSecondaryInfo}</p>

                <div className="mt-4 pt-4 border-t border-white/10 grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {[
                    { label: "Total Cars", value: cars.length, icon: Car, tab: "cars" },
                    { label: "Guests Invited", value: guestCount, icon: Users, tab: null },
                    { label: "Drivers", value: event.drivers?.length ?? 0, icon: Users, tab: "drivers" },
                    { label: "Avg Rating", value: event.stats?.avg_rating > 0 ? event.stats?.avg_rating + "★" : "—", icon: Star, tab: null },
                    { label: "Incidents", value: event.stats?.total_incidents ?? 0, icon: AlertTriangle, tab: "incidents" }
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
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={generateCSV}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/30 text-white bg-white/10 hover:bg-white/20 transition text-sm font-semibold"
                >
                  <FileSpreadsheet className="w-4 h-4" /> Export CSV
                </button>
                <button
                  onClick={generatePDF}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/30 text-white bg-white/10 hover:bg-white/20 transition text-sm font-semibold"
                >
                  <FileText className="w-4 h-4" /> PDF Report
                </button>

                {event.status === "active" && (
                  <button
                    onClick={handleCloseEvent}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-red-600 text-white hover:bg-red-700 transition"
                  >
                    <X className="w-4 h-4" /> Close Event
                  </button>
                )}
              </div>

              {/* {(!event.event_type || event.event_type === "hotel_special" || event.event_type === "regular") && (
                eventQrToken ? (
                  <div className="hidden sm:flex flex-row items-center gap-3 bg-white/10 border border-white/20 rounded-xl p-3">
                    <div className="bg-white rounded-lg p-1.5 cursor-pointer" onClick={() => setShowQRModal(true)}>
                      <QRCodeSVG
                        id="special-event-qr-small"
                        value={`${window.location.origin}/pre-register/event/${eventQrToken}`}
                        size={88}
                      />
                    </div>
                    <div className="flex flex-col gap-1 items-start">
                      <div className="text-[10px] text-white/60 uppercase font-bold tracking-wider">{event.event_type === "hotel_special" ? "Special Event QR" : "Event QR"}</div>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`${window.location.origin}/pre-register/event/${eventQrToken}`);
                          toast.success("Link copied!");
                        }}
                        className="text-xs text-white/80 hover:text-white underline text-left"
                      >
                        Copy Link
                      </button>
                      <button
                        onClick={() => {
                          const svg = document.getElementById("special-event-qr-small");
                          const svgData = new XMLSerializer().serializeToString(svg);
                          const canvas = document.createElement("canvas");
                          canvas.width = 300; canvas.height = 300;
                          const ctx = canvas.getContext("2d");
                          const img = new Image();
                          img.onload = () => { ctx.drawImage(img, 0, 0, 300, 300); const a = document.createElement("a"); a.download = "special-event-qr.png"; a.href = canvas.toDataURL("image/png"); a.click(); };
                          img.src = "data:image/svg+xml;base64," + btoa(svgData);
                        }}
                        className="flex items-center gap-1 text-xs text-white/80 hover:text-white text-left"
                      >
                        <Download className="w-3 h-3" /> Download
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="hidden sm:flex flex-row items-center gap-3 bg-white/5 border border-white/10 rounded-xl p-3 px-4">
                    <div className="text-white/40 text-xs italic font-semibold">QR unavailable</div>
                  </div>
                )
              )} */}
            </div>
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
            { id: "feedback", label: "Feedback", icon: MessageSquare },
            ...(event?.status === "active" ? [{ id: "queue", label: "Live Queue", icon: Radio, live: true }] : [])
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
              {tab.live && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-1" />}
              {tab.live && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-1" />}
            </button>
          ))}
        </div>
      </div>

      {/* {showQRModal && eventQrToken && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowQRModal(false)}>
          <div className="bg-white rounded-2xl p-8 flex flex-col items-center gap-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-[#0F2044] text-lg">{event.event_type === "hotel_special" ? "Special Event QR" : "Event QR"}</h3>
            <p className="text-sm text-gray-500">Guests scan this to pre-register for this event</p>
            <QRCodeSVG
              id="special-event-qr-large"
              value={`${window.location.origin}/pre-register/event/${eventQrToken}`}
              size={250}
            />
            <div className="flex gap-3">
              <button
                onClick={() => {
                  if (navigator.share) {
                    navigator.share({ title: "Pre-register for " + event.name, url: `${window.location.origin}/pre-register/event/${eventQrToken}` });
                  } else {
                    navigator.clipboard.writeText(`${window.location.origin}/pre-register/event/${eventQrToken}`);
                    toast.success("Link copied!");
                  }
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                <ExternalLink className="w-4 h-4" /> Share
              </button>
              <button
                onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/pre-register/event/${eventQrToken}`); toast.success("Link copied!"); }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                <Copy className="w-4 h-4" /> Copy Link
              </button>
              <button
                onClick={() => {
                  const svg = document.getElementById("special-event-qr-large");
                  const svgData = new XMLSerializer().serializeToString(svg);
                  const canvas = document.createElement("canvas");
                  canvas.width = 300; canvas.height = 300;
                  const ctx = canvas.getContext("2d");
                  const img = new Image();
                  img.onload = () => { ctx.drawImage(img, 0, 0, 300, 300); const a = document.createElement("a"); a.download = "special-event-qr.png"; a.href = canvas.toDataURL("image/png"); a.click(); };
                  img.src = "data:image/svg+xml;base64," + btoa(svgData);
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0F2044] text-white text-sm font-semibold hover:bg-[#1a3c6e]"
              >
                <Download className="w-4 h-4" /> Download QR
              </button>
            </div>
            <button onClick={() => setShowQRModal(false)} className="text-xs text-gray-400 hover:text-gray-600">Close</button>
          </div>
        </div>
      )} */}

      <div className="mt-6">
        {activeTab === "info" && (
          <div className="grid grid-cols-1 gap-6">
            {/* Stats Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
              {[
                { label: "Cars", value: event.total_cars, icon: <Car className="w-5 h-5 text-blue-600" />, bg: "bg-blue-50" },
                { label: "Avg Rating", value: event.stats?.avg_rating || "—", icon: <Star className="w-5 h-5 text-amber-600" />, bg: "bg-amber-50" },
                { label: "Avg Retrieval", value: `${event.stats?.avg_retrieval_minutes || "—"}m`, icon: <Clock className="w-5 h-5 text-purple-600" />, bg: "bg-purple-50" },
                { label: "Top Driver", value: event.stats?.top_driver || "—", icon: <Users className="w-5 h-5 text-emerald-600" />, bg: "bg-emerald-50" },
              ].map((s, i) => (
                <div key={i} className="bg-white rounded-xl shadow-card border border-gray-100 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                    <div className="text-[10px] uppercase font-bold tracking-widest text-gray-400">{s.label}</div>
                    <div className={`p-1.5 rounded-lg ${s.bg}`}>{s.icon}</div>
                  </div>
                  <div className="font-heading text-xl font-bold text-[#0F2044]">{s.value}</div>
                </div>
              ))}
            </div>

            {/* Event Host (Only for Regular Events) */}
            {/* {event.event_type !== "hotel_daily" && (
              <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-6">
                <h3 className="font-heading text-lg font-bold text-[#0F2044] mb-4">Event Host</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1">Host Name</label>
                    <input
                      type="text"
                      value={event.host_name || ""}
                      onChange={e => setEvent({ ...event, host_name: e.target.value })}
                      placeholder="e.g. John Doe"
                      className="w-full px-4 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#1D4ED8]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1">Host Email</label>
                    <div className="flex gap-2">
                      <input
                        type="email"
                        value={event.host_email || ""}
                        onChange={e => setEvent({ ...event, host_email: e.target.value })}
                        placeholder="john@example.com"
                        disabled={isClosed}
                        className={`flex-1 px-4 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#1D4ED8] ${isClosed ? "bg-gray-50 text-gray-400" : ""}`}
                      />
                      {isClosed ? (
                        <div className="px-4 py-2 bg-gray-100 text-gray-400 text-sm font-bold rounded-xl border border-gray-200 flex items-center justify-center whitespace-nowrap">
                          Cannot send — Closed
                        </div>
                      ) : (
                        <button
                          onClick={async () => {
                            if (!event.host_email) return toast.error("Please enter host email");
                            try {
                              await api.patch(`/events/${eid}/host`, {
                                host_name: event.host_name,
                                host_email: event.host_email
                              });
                              toast.success("Host updated and portal email sent");
                              load();
                            } catch (err) {
                              toast.error(err?.response?.data?.detail || "Failed to update host");
                            }
                          }}
                          className="px-4 py-2 bg-[#1A3C6E] text-white text-sm font-bold rounded-xl hover:bg-[#0F2044] transition-colors whitespace-nowrap"
                        >
                          {event.host_email_sent ? "Resend Portal" : "Send Portal"}
                        </button>
                      )}

                    </div>
                  </div>
                </div>
                {event.host_email_sent && (
                  <div className="mt-3 text-xs font-bold text-emerald-600 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Portal email sent
                  </div>
                )}
              </div>
            )} */}

            {event.status !== "closed" && (
              <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-6 mt-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="font-heading text-lg font-bold text-[#0F2044]">Edit Event</h3>
                  {!editOpen && (
                    <button
                      onClick={() => setEditOpen(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1A3C6E] text-white text-xs font-bold hover:bg-[#0F2044] transition-all"
                    >
                      <Edit2 className="w-3.5 h-3.5" /> Edit
                    </button>
                  )}
                </div>
                {editOpen ? (
                  <form onSubmit={handleEditEvent} className="space-y-4">
                    <div className="grid grid-cols-1 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Event Name <span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          value={editForm.name}
                          onChange={(e) => { setEditForm({ ...editForm, name: e.target.value}); if (editErrors.name) setEditErrors(prev => ({ ...prev, name: undefined })); }}
                          className={`w-full px-4 py-2 rounded-xl border ${editErrors.name ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`}
                        />
{ editErrors.name && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.name}</p> }
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Venue <span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          value={editForm.venue}
                          onChange={(e) => { setEditForm({ ...editForm, venue: e.target.value}); if (editErrors.venue) setEditErrors(prev => ({ ...prev, venue: undefined })); }}
                          className={`w-full px-4 py-2 rounded-xl border ${editErrors.venue ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`}
                        />
{ editErrors.venue && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.venue}</p> }
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Date <span className="text-red-500">*</span></label>
                          <input
                            type="date"
                            value={editForm.date}
                            onChange={(e) => { setEditForm({ ...editForm, date: e.target.value}); if (editErrors.date) setEditErrors(prev => ({ ...prev, date: undefined })); }}
                            className={`w-full px-4 py-2 rounded-xl border ${editErrors.date ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`}
                          />
{ editErrors.date && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.date}</p> }
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">End Date</label>
                          <input
                            type="date"
                            value={editForm.end_date}
                            onChange={(e) => { setEditForm({ ...editForm, end_date: e.target.value}); if (editErrors.end_date) setEditErrors(prev => ({ ...prev, end_date: undefined })); }}
                            className={`w-full px-4 py-2 rounded-xl border ${editErrors.end_date ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`}
                          />
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
                          <input
                            type="number"
                            min={1}
                            value={editForm.max_cars}
                            onChange={(e) => { setEditForm({ ...editForm, max_cars: e.target.value}); if (editErrors.max_cars) setEditErrors(prev => ({ ...prev, max_cars: undefined })); }}
                            className={`w-full px-4 py-2 rounded-xl border ${editErrors.max_cars ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`}
                          />
{ editErrors.max_cars && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.max_cars}</p> }
                        </div>
                        <div>
                          <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Gate Wait Timer (minutes)</label>
                          <input
                            type="number"
                            min="1"
                            max="30"
                            value={editForm.gate_timer_minutes}
                            onChange={(e) => { setEditForm({ ...editForm, gate_timer_minutes: e.target.value}); if (editErrors.gate_timer_minutes) setEditErrors(prev => ({ ...prev, gate_timer_minutes: undefined })); }}
                            className={`w-full border ${editErrors.gate_timer_minutes ? "border-red-400" : "border-gray-200"} rounded-xl px-4 py-3 text-sm text-[#0F2044] focus:outline-none focus:border-[#1A3C6E] bg-white mt-1`}
                          />
{ editErrors.gate_timer_minutes && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.gate_timer_minutes}</p> }
                          <p className="text-xs text-gray-400 mt-1">How long the guest has to reach the gate before the car is sent back to parking.</p>
                        </div>
                        <div className="flex items-center gap-2 mt-4">
                          <input type="checkbox" id="edit_allow_instant_park" checked={editForm.allow_instant_park}
                                 onChange={(e) => setEditForm({ ...editForm, allow_instant_park: e.target.checked })}
                                 className="w-4 h-4 text-[#1D4ED8] bg-gray-100 border-gray-300 rounded focus:ring-[#1D4ED8]" />
                          <label htmlFor="edit_allow_instant_park" className="text-xs font-semibold text-gray-600 uppercase cursor-pointer">
                            Allow Instant Park for this event
                          </label>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Key Hooks From</label>
                            <input
                              type="number"
                              min={1}
                              value={editForm.key_hook_start}
                              onChange={(e) => { setEditForm({ ...editForm, key_hook_start: e.target.value}); if (editErrors.key_hook_start) setEditErrors(prev => ({ ...prev, key_hook_start: undefined })); }}
                              className={`w-full px-4 py-2 rounded-xl border ${editErrors.key_hook_start ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`}
                            />
{ editErrors.key_hook_start && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.key_hook_start}</p> }
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Key Hooks To</label>
                            <input
                              type="number"
                              min={1}
                              value={editForm.key_hook_end}
                              onChange={(e) => { setEditForm({ ...editForm, key_hook_end: e.target.value}); if (editErrors.key_hook_end) setEditErrors(prev => ({ ...prev, key_hook_end: undefined })); }}
                              className={`w-full px-4 py-2 rounded-xl border ${editErrors.key_hook_end ? "border-red-400" : "border-gray-200"} focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]`}
                            />
{ editErrors.key_hook_end && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.key_hook_end}</p> }
                          </div>
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
                        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">
                            Parking Zones
                          </label>
                          <span className={`text-xs font-bold ${totalSlots > editForm.max_cars ? "text-red-500" : "text-emerald-600"}`}>
                            {totalSlots} / {editForm.max_cars || "—"} slots
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
                      </div>
                    </div>

                    <p className="text-xs text-gray-400 mb-2"><span className="text-red-500">*</span> Required fields</p>
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
                  <div className="space-y-3 text-sm text-gray-600">
                    <div><span className="text-[10px] uppercase font-bold text-gray-400">Name</span><div className="font-semibold text-[#0F2044] mt-0.5">{event.name}</div></div>
                    <div><span className="text-[10px] uppercase font-bold text-gray-400">Venue</span><div className="font-semibold text-[#0F2044] mt-0.5">{event.venue || "—"}</div></div>
                    <div><span className="text-[10px] uppercase font-bold text-gray-400">Date</span><div className="font-semibold text-[#0F2044] mt-0.5">{event.date} {event.end_date && event.end_date !== event.date ? `→ ${event.end_date}` : ""}</div></div>
                    <div><span className="text-[10px] uppercase font-bold text-gray-400">Time</span><div className="font-semibold text-[#0F2044] mt-0.5">{event.start_time} – {event.end_time}</div></div>
                    <div><span className="text-[10px] uppercase font-bold text-gray-400">Max Cars</span><div className="font-semibold text-[#0F2044] mt-0.5">{event.max_cars}</div></div>
                    <div><span className="text-[10px] uppercase font-bold text-gray-400">Gate Timer</span><div className="font-semibold text-[#0F2044] mt-0.5">{event.gate_timer_minutes || 5} min</div></div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === "drivers" && (<>
          {/* Drivers Section */}
          {selectedDriver === null ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <h2 className="font-heading text-lg font-bold text-[#0F2044]">Drivers</h2>
                <div className="relative w-full sm:w-64">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    value={driverSearch}
                    onChange={(e) => setDriverSearch(e.target.value)}
                    placeholder="Search by name or employee ID"
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-[#1A3C6E]"
                  />
                </div>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden mb-8">
                {drivers.length === 0 ? (
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
                          <th className="text-right px-5 py-3.5">Performance</th>
                          <th className="text-right px-5 py-3.5">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredDrivers.length === 0 && driverSearch && (
                          <tr><td colSpan="8" className="text-center text-gray-400 py-10">No drivers match your search</td></tr>
                        )}
                        {paginatedDrivers.map(driver => {
                          const carsAssigned = driver.checkins ?? driver.cars_checked_in ?? 0;
                          const perfLabel = carsAssigned >= 15 ? "High" : carsAssigned >= 7 ? "Moderate" : "Low";
                          const perfClass = carsAssigned >= 15 ? "bg-emerald-100 text-emerald-700" : carsAssigned >= 7 ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600";
                          const isAssigned = driver.assigned;
                          const isConflict = !driver.available;
                          const isUnverified = driver.is_verified === false;

                          return (
                            <tr key={driver.id}
                              onClick={() => handleDriverClick(driver)}
                              className="border-t border-gray-50 table-row-hover cursor-pointer group">
                              <td className="px-5 py-3.5">
                                <div className="font-semibold text-[#1A3C6E] group-hover:underline">{driver.name}</div>
                                <div className="text-xs text-gray-400 font-mono">{driver.employee_id}</div>
                              </td>
                              <td className="px-5 py-3.5 text-center">
                                {isAssigned ? (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase tracking-wide">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                    Assigned Here
                                  </span>
                                ) : isConflict ? (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 text-red-600 text-[10px] font-bold uppercase tracking-wide">
                                    <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                                    In {driver.conflict_event_name || 'another event'}
                                  </span>
                                ) : isUnverified ? (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 text-[10px] font-bold uppercase tracking-wide">
                                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400"></span>
                                    Unverified
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 text-[10px] font-bold uppercase tracking-wide">
                                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                                    Available
                                  </span>
                                )}
                              </td>
                              <td className="px-5 py-3.5 text-center font-semibold">{driver.cars_checked_in ?? 0}</td>
                              <td className="px-5 py-3.5 text-center font-semibold">{driver.cars_retrieved ?? 0}</td>
                              <td className={`px-5 py-3.5 text-center font-bold ${driver.incidents > 0 ? "text-red-500" : "text-emerald-500"}`}>
                                {driver.incidents ?? 0}
                              </td>
                              <td className="px-5 py-3.5 text-right">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${perfClass}`}>
                                  {perfLabel}
                                </span>
                              </td>
                              <td className="px-5 py-3.5 text-right">
                                {isAssigned ? (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleUnassignDriver(driver.id); }}
                                    className="px-3 py-1.5 rounded-lg bg-red-50 text-red-600 text-xs font-bold hover:bg-red-100 transition-colors"
                                  >
                                    Unassign
                                  </button>
                                ) : (!isConflict && !isUnverified) ? (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleAssignDriver(driver.id); }}
                                    className="px-3 py-1.5 rounded-lg bg-[#1A3C6E] text-white text-xs font-bold hover:bg-[#0F2044] transition-colors shadow-sm"
                                  >
                                    Assign
                                  </button>
                                ) : (
                                  <div className="px-3 py-1.5 rounded-lg bg-gray-50 text-gray-400 text-xs font-bold border border-gray-100 inline-block">
                                    {isUnverified ? "Unverified" : "Busy"}
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
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


            </>
          ) : (
            <div className="mb-6">
              <button
                onClick={() => { setSelectedDriver(null); setDriverCars([]); }}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-[#1A3C6E] hover:text-[#0F2044] mb-4 transition-colors">
                <ArrowLeft className="w-4 h-4" /> Back to Drivers List
              </button>

              <h3 className="font-heading text-lg font-bold text-[#0F2044] mb-1">
                {selectedDriver.name}
              </h3>
              <p className="text-gray-400 text-sm mb-4">Cars handled in this event</p>

              {carsLoading ? (
                <div className="flex justify-center py-10">
                  <div className="animate-spin border-4 border-[#1A3C6E] border-t-transparent rounded-full w-7 h-7" />
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
                  <div className="overflow-x-auto w-full max-w-full">
                    <table className="w-full text-sm min-w-[600px]">
                      <thead className="bg-gradient-to-r from-gray-50 to-gray-100/50 text-gray-400 uppercase text-[11px] tracking-widest font-bold">
                        <tr>
                          <th className="text-left px-5 py-3.5">Plate</th>
                          <th className="text-left px-5 py-3.5">Make</th>
                          <th className="text-left px-5 py-3.5">Color</th>
                          <th className="text-left px-5 py-3.5">Status</th>
                          <th className="text-left px-5 py-3.5">Role</th>
                          <th className="text-left px-5 py-3.5">Entry Time</th>
                          <th className="text-left px-5 py-3.5">Exit Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {driverCars.length === 0 && (
                          <tr><td colSpan="7" className="text-center text-gray-400 py-10">
                            No cars found for this driver in this event
                          </td></tr>
                        )}
                        {paginatedDriverCars.map(c => (
                          <tr key={c.id} className="border-t border-gray-50">
                            <td className="px-5 py-3.5 font-mono font-bold text-[#0F2044]">{c.plate}</td>
                            <td className="px-5 py-3.5 text-gray-500">{c.make}</td>
                            <td className="px-5 py-3.5 text-gray-500">{c.color}</td>
                            <td className="px-5 py-3.5">
                              <StatusBadge status={c.status} />
                            </td>
                            <td className="px-5 py-3.5">
                              {c.role_in_event === "check_in" && <span className="badge badge-blue">Check-in</span>}
                              {c.role_in_event === "retrieval" && <span className="badge badge-purple">Retrieval</span>}
                              {c.role_in_event === "both" && <span className="badge badge-navy">Both</span>}
                            </td>
                            <td className="px-5 py-3.5 text-gray-400 text-xs font-mono">
                              {fmtDateTime(c.check_in_time)}
                            </td>
                            <td className="px-5 py-3.5 text-gray-400 text-xs font-mono">
                              {fmtDateTime(c.delivered_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {driverCars.length > 10 && (
                      <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between">
                        <span className="text-sm text-gray-400">
                          Showing {Math.min((driverCarsPage - 1) * 10 + 1, driverCars.length)}–{Math.min(driverCarsPage * 10, driverCars.length)} of {driverCars.length}
                        </span>
                        <div className="flex items-center gap-2">
                          <button disabled={driverCarsPage === 1} onClick={() => setDriverCarsPage(p => p - 1)}
                            className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Prev</button>
                          <span className="px-3 py-1.5 rounded-lg bg-[#0F2044] text-white text-sm font-bold">{driverCarsPage}</span>
                          <button disabled={driverCarsPage * 10 >= driverCars.length} onClick={() => setDriverCarsPage(p => p + 1)}
                            className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Next</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
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
            {filteredIncidents.length > 10 && (
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
              <h3 className="font-heading font-bold text-gray-800 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-gray-400" />
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
                          <span className="text-xs text-gray-400 ml-2">{fmtDateTime(item.created_at)}</span>
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

        {activeTab === "supervisors" && (<>
          {/* Supervisors Section */}
          <div className="mb-10">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h2 className="font-heading text-lg font-bold text-[#0F2044]">Supervisors</h2>
              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={supervisorSearch}
                  onChange={(e) => setSupervisorSearch(e.target.value)}
                  placeholder="Search by name or email"
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-[#1A3C6E]"
                />
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
              {supervisors.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <p className="text-2xl mb-2">👷</p>
                  <p className="text-sm">No supervisors found for this provider.</p>
                  <p className="text-xs mt-1">Add supervisors from the Team Management page first.</p>
                </div>
              ) : (
                <div className="overflow-x-auto w-full max-w-full">
                  <table className="w-full text-sm min-w-[600px]">
                    <thead className="bg-gradient-to-r from-gray-50 to-gray-100/50 text-gray-400 uppercase text-[11px] tracking-widest font-bold">
                      <tr>
                        <th className="text-left px-5 py-3.5">Name</th>
                        <th className="text-left px-5 py-3.5">Email</th>
                        <th className="text-left px-5 py-3.5">Phone</th>
                        <th className="text-left px-5 py-3.5">Availability</th>
                        <th className="text-right px-5 py-3.5">Action</th>
                      </tr>
                    </thead>
                    <tbody className={supsLoading ? "opacity-50 pointer-events-none" : ""}>
                      {filteredSupervisors.length === 0 && supervisorSearch && (
                        <tr><td colSpan="5" className="text-center text-gray-400 py-10">
                          No supervisors match your search
                        </td></tr>
                      )}
                      {paginatedSupervisors.map(s => (
                        <tr key={s.id} className={`border-t border-gray-50 ${!s.available && !s.assigned ? "opacity-50" : ""}`}>
                          <td className="px-5 py-3.5 font-semibold text-[#1A3C6E]">
                            {s.name}
                            {s.is_verified === false && (
                              <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full ml-2 font-bold uppercase tracking-wider">
                                Unverified
                              </span>
                            )}
                            {s.conflict_event_name && (
                              <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full ml-2">
                                ⚠️ Conflict: {s.conflict_event_name}
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3.5 text-gray-500">{s.email}</td>
                          <td className="px-5 py-3.5 text-gray-500">{s.phone || "—"}</td>
                          <td className="px-5 py-3.5">
                            {s.available ? (
                              <span className="inline-flex items-center gap-1.5 text-emerald-600 font-medium">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Available
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-amber-600 font-medium" title={s.conflict_event_name ? `Conflicts with: ${s.conflict_event_name}` : "Busy elsewhere"}>
                                <Clock className="w-3.5 h-3.5" /> Assigned to: {s.conflict_event_name || "Another Event"}
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            {s.assigned ? (
                              <button onClick={() => handleUnassignSupervisor(s.id)} className="badge badge-red hover:bg-red-200 transition-colors">Unassign</button>
                            ) : (
                              <button
                                onClick={() => handleAssignSupervisor(s.id)}
                                disabled={(!s.available && !s.conflict_event_name) || s.is_verified === false}
                                title={s.is_verified === false ? "Cannot assign unverified supervisor" : (s.conflict_event_name ? `Conflicts with: ${s.conflict_event_name}` : "")}
                                className={`badge transition-colors ${s.is_verified === false ? "bg-gray-100 text-gray-400 cursor-not-allowed" : (s.available || s.conflict_event_name ? "badge-blue hover:bg-blue-200" : "bg-gray-100 text-gray-400 cursor-not-allowed")}`}
                              >
                                Assign
                              </button>
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
        </>
        )}

        {activeTab === "cars" && (<>
          {/* Cars Log Section */}
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

            {carStatusFilter !== "all" && (
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1A3C6E]/10 text-[#1A3C6E] text-xs font-semibold">
                  Status: {carStatusFilter} <button onClick={() => setCarStatusFilter("all")}>×</button>
                </span>
              </div>
            )}

            <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto w-full max-w-full">
                <div className="overflow-x-auto w-full max-w-full">
                  <table className="w-full text-sm min-w-[600px]">
                    <thead className="bg-gray-50 text-gray-500 uppercase text-xs font-semibold">
                      <tr>
                        <th className="text-left px-5 py-3">Plate</th>
                        <th className="text-left px-5 py-3">Make/Color</th>
                        <th className="text-left px-5 py-3">Gate</th>
                        <th className="text-left px-5 py-3">Zone/Slot</th>
                        <th className="text-left px-5 py-3 relative filter-dropdown-container">
                          <span
                            onClick={() => setOpenDropdown(openDropdown === 'carStatus' ? null : 'carStatus')}
                            className={`flex items-center gap-1 cursor-pointer select-none ${carStatusFilter !== "all" ? "text-[#1A3C6E] font-bold" : ""}`}
                          >
                            STATUS <ChevronDown className={`w-3 h-3 ${carStatusFilter !== "all" ? "text-[#1A3C6E]" : ""}`} />
                          </span>
                          {openDropdown === 'carStatus' && (
                            <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg p-1 min-w-[160px] font-normal normal-case text-left">
                              {["all", "CHECKED_IN", "PARKED", "RETRIEVAL_REQUESTED", "BEING_FETCHED", "DELIVERED"].map(opt => (
                                <div key={opt} onClick={() => { setCarStatusFilter(opt); setOpenDropdown(null); }} className="px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-gray-50 flex items-center gap-2 capitalize">
                                  {carStatusFilter === opt ? <div className="w-2 h-2 rounded-full bg-[#1A3C6E]" /> : <div className="w-2 h-2" />}
                                  {opt}
                                </div>
                              ))}
                            </div>
                          )}
                        </th>
                        <th className="text-left px-5 py-3">Check-in Driver</th>
                        <th className="text-left px-5 py-3">Retrieved By</th>
                        <th className="text-left px-5 py-3">Entry Time</th>
                        <th className="text-left px-5 py-3">Exit Time</th>
                        <th className="text-left px-5 py-3">SMS</th>
                        <th className="text-right px-5 py-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCars.map(c => (
                        <>
                          <tr
                            key={c.id}
                            onClick={() => setExpandedCarId(expandedCarId === c.id ? null : c.id)}
                            className="border-t border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors"
                          >
                            <td className="px-5 py-3 font-bold uppercase">
                              <div className="flex items-center gap-2">
                                {c.plate}
                                {c.carried_forward && (
                                  <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                                    Overnight
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-5 py-3 text-gray-600">{c.make} / {c.color}</td>
                            <td className="px-5 py-3 text-gray-500">{c.gate || "—"}</td>
                            <td className="px-5 py-3 font-medium">{c.zone ? `${c.zone} / ${c.slot}` : "—"}</td>
                            <td className="px-5 py-3">
                              <StatusBadge status={c.status} />
                            </td>
                            <td className="px-5 py-3 text-gray-600">{c.check_in_driver_name}</td>
                            <td className="px-5 py-3 text-gray-600">{c.retrieval_driver_name}</td>
                            <td className="px-5 py-3 text-gray-400 font-mono text-[11px]">
                              {c.check_in_time ? fmtTime(c.check_in_time) : "—"}
                            </td>
                            <td className="px-5 py-3 text-gray-400 font-mono text-[11px]">
                              {c.delivered_at ? fmtTime(c.delivered_at) : "—"}
                            </td>
                            <td className="px-5 py-3">
                              {c.guest_phone ? (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleResendSms(c); }}
                                  title={`Resend SMS to ${c.guest_phone}`}
                                  className="p-1.5 rounded-lg text-violet-600 hover:bg-violet-50 transition"
                                >
                                  <MessageSquare className="w-4 h-4" />
                                </button>
                              ) : (
                                <span title="No phone number on file" className="inline-flex p-1.5 rounded-lg text-gray-300 cursor-not-allowed">
                                  <MessageSquare className="w-4 h-4" />
                                </span>
                              )}
                            </td>
                            <td className="px-5 py-3 text-right">
                              <ChevronDown className={`w-4 h-4 text-gray-300 transition-transform ${expandedCarId === c.id ? "rotate-180" : ""}`} />
                            </td>
                          </tr>
                          {expandedCarId === c.id && (
                            <tr key={`${c.id}-expanded`} className="border-t border-gray-100">
                              <td colSpan={11} className="px-5 py-4 bg-blue-50/40">
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                  {[
                                    ["Guest Name", c.guest_name || "—"],
                                    ["Guest Phone", c.guest_phone || "—"],
                                    ["Key Tag", c.key_tag || "—"],
                                    ["Notes", c.notes || "—"],
                                    ["Parked At", c.parked_at ? fmtDateTime(c.parked_at) : "—"],
                                    ["Retrieval Requested", c.retrieval_requested_at ? fmtDateTime(c.retrieval_requested_at) : "—"],
                                    ["Duration", c.duration_minutes ? c.duration_minutes + " min" : "—"],
                                    ["Rating", c.rating ? "★ " + c.rating : "—"],
                                    ...(c.carried_forward ? [["Overnight Stay", "Yes — carried forward from previous day"]] : []),
                                  ].map(([label, value]) => (
                                    <div key={label}>
                                      <div className="text-[10px] uppercase text-gray-400 font-bold">{label}</div>
                                      <div className="text-sm font-semibold text-[#0F2044] mt-1">{value}</div>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      ))}
                      {filteredCars.length === 0 && <tr><td colSpan="11" className="p-8 text-center text-gray-400">{carSearch ? "No cars match your search" : "No car activity recorded"}</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </>
        )}

        {activeTab === "queue" && event?.status === "active" && (
          <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-heading text-lg font-bold text-[#0F2044]">Live Queue — {event.name}</h2>
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live · refreshes every 5s
              </span>
            </div>
            {loadingLiveQueue ? (
              <div className="py-16 flex justify-center"><div className="w-8 h-8 border-4 border-[#1A3C6E] border-t-transparent rounded-full animate-spin" /></div>
            ) : eventLiveQueue.length === 0 ? (
              <div className="py-16 text-center text-gray-400 text-sm">No cars in queue right now</div>
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
                    {eventLiveQueue.map(c => (
                      <tr key={c.car_id} onClick={() => nav(`/superadmin/cars/${c.car_number}`)}
                        className="border-t border-gray-100 hover:bg-[#F4F6FA] cursor-pointer transition-colors">
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
          </div>
        )}



      </div>


    </SuperLayout>
  );
}
