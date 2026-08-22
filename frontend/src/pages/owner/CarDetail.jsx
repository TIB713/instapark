import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import OwnerLayout from "@/components/layout/OwnerLayout";
import { api } from "@/lib/api";
import { fmtTime, fmtDate, fmtDateTime, fmtDateTimeFull, fmtDuration } from "@/lib/time";
import { toast } from "sonner"; 
import { ArrowLeft, Bell, Car, Calendar, MapPin, User, Clock, Star, Camera, Building2, AlertTriangle, Download, X, UserCog } from "lucide-react"; 
import StatusBadge from "@/components/ui/StatusBadge";
import DriverPathMap from "@/components/DriverPathMap";
import CarLogTimeline from "@/components/CarLogTimeline";

function VisitTimelineFetcher({ carId, setLightbox }) {
  const [log, setLog] = useState(null);
  
  useEffect(() => {
    api.get(`/cars/${carId}/log`)
      .then(({ data }) => setLog(data))
      .catch(() => toast.error("Failed to load car log"));
  }, [carId]);
  
  if (!log) return <div className="text-sm text-gray-500 italic py-4">Loading timeline...</div>;
  return <CarLogTimeline log={log} setLightbox={setLightbox} />;
}

export default function CarDetail() { 
  const { plate } = useParams(); 
  const decodedPlate = decodeURIComponent(plate).toUpperCase(); 
  const [data, setData] = useState(null); 
  const [loading, setLoading] = useState(true); 
  const [expandedVisit, setExpandedVisit] = useState(null); 
  const [incidentsMap, setIncidentsMap] = useState({}); 
  const [lightbox, setLightbox] = useState(null);
  const [pathMapVisit, setPathMapVisit] = useState(null);
 
  useEffect(() => {
    if (!lightbox) return;
    const handleEsc = (e) => {
      if (e.key === "Escape") {
        setLightbox(null);
      }
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [lightbox]);

  useEffect(() => { 
    api.get(`/provider/cars/${encodeURIComponent(decodedPlate)}/history`) 
      .then(async r => {
        setData(r.data);
        const carIds = r.data.visits.map(v => v.car_id); 
        const incidentResults = await Promise.all( 
          carIds.map(cid => 
            api.get(`/incidents/car/${cid}`) 
              .then(r => ({ cid, incidents: r.data })) 
              .catch(() => ({ cid, incidents: [] })) 
          ) 
        ); 
        const incidentsMap = {}; 
        incidentResults.forEach(({ cid, incidents }) => { 
          incidentsMap[cid] = incidents; 
        }); 
        setIncidentsMap(incidentsMap);
      }) 
      .catch(() => toast.error("Failed to load car history")) 
      .finally(() => setLoading(false)); 
  }, [decodedPlate]); 

  const generateCarPDF = async () => {
    try {
      const generatedAt = fmtDateTimeFull(new Date().toISOString());

      const visitRows = data.visits.map((v, i) => {
        const incidents = v.incidents || [];
        const photos = v.photos || [];

        const incidentsHtml = incidents.length > 0 ? `
        <div style="margin-top:14px;border:2px solid #FCA5A5;
          border-radius:8px;padding:12px;background:#FEF2F2;">
          <div style="font-size:11px;font-weight:800;color:#991B1B;
            text-transform:uppercase;letter-spacing:1px;
            margin-bottom:8px;">
            Incidents (${incidents.length})
          </div>
          ${incidents.map((inc) => `
            <div style="border-bottom:1px solid #FECACA;
              padding:8px 0;margin-bottom:8px;">
              <div style="font-size:11px;color:#6b7280;margin-bottom:4px;">
                ${inc.created_at
                  ? fmtDateTime(inc.created_at)
                  : "â€”"}
              </div>
              <div style="font-size:12px;color:#111827;margin-bottom:4px;">
                ${inc.description || "â€”"}
              </div>
              <div style="font-size:11px;color:#991B1B;">
                Driver: ${inc.driver_name || "â€”"}
              </div>
              ${inc.photo_url ? `
              <div style="margin-top:6px;">
                <a href="${inc.photo_url}"
                  style="font-size:11px;color:#1A3C6E;">
                  View incident photo evidence â†’
                </a>
              </div>` : ""}
            </div>`
          ).join("")}
        </div>` : "";

        const photosHtml = photos.length > 0 ? `
        <div style="margin-top:14px;">
          <div style="font-size:11px;font-weight:800;color:#0F2044;
            text-transform:uppercase;letter-spacing:1px;
            margin-bottom:8px;">
            Valet Documentation Photos
          </div>
          <div style="display:flex;flex-wrap:wrap;">
            ${photos.map((photo) => `
              <img src="${photo.url || photo.photo_url || ""}"
                alt="Valet documentation"
                style="max-height:120px;border-radius:6px;
                  margin:4px;border:1px solid #e5e7eb;" />
            `).join("")}
          </div>
        </div>` : "";

        return `
      <div style="border:1px solid #e5e7eb;border-radius:12px;
        padding:16px;margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;
          align-items:center;margin-bottom:10px;">
          <div>
            <span style="font-weight:900;font-size:15px;
              color:#111827;">
              Visit ${i + 1} — ${v.event_name}
            </span>
            <span style="margin-left:10px;background:#f3f4f6;
              padding:2px 8px;border-radius:99px;font-size:11px;
              color:#6b7280;">${v.status}</span>
          </div>
          <span style="color:#9ca3af;font-size:12px;">
            ${v.event_date || ""}
          </span>
        </div>
        <table style="width:100%;border-collapse:collapse;
          font-size:12px;">
          <tr>
            <td style="padding:4px 8px;color:#6b7280;
              width:140px;">Check-in</td>
            <td style="padding:4px 8px;">
              ${v.check_in_time
                ? fmtDateTime(v.check_in_time) : "—"}
              ${v.check_in_driver
                ? "by " + v.check_in_driver : ""}
            </td>
          </tr>
          <tr>
            <td style="padding:4px 8px;color:#6b7280;">
              Parked
            </td>
            <td style="padding:4px 8px;">
              ${v.zone
                ? "Zone " + v.zone + " Slot " + v.slot : "—"}
              ${v.key_tag ? "· Key #" + v.key_tag : ""}
              ${v.parked_driver
                ? "by " + v.parked_driver : ""}
            </td>
          </tr>
          <tr>
            <td style="padding:4px 8px;color:#6b7280;">
              Delivered
            </td>
            <td style="padding:4px 8px;">
              ${v.delivered_at
                ? fmtDateTime(v.delivered_at) : "—"}
              ${v.retrieval_driver
                ? "by " + v.retrieval_driver : ""}
            </td>
          </tr>
          ${v.duration_minutes ? `
          <tr>
            <td style="padding:4px 8px;color:#6b7280;">
              Duration
            </td>
            <td style="padding:4px 8px;">
              ${v.duration_minutes} minutes
            </td>
          </tr>` : ""}
          ${v.rating ? `
          <tr>
            <td style="padding:4px 8px;color:#6b7280;">
              Rating
            </td>
            <td style="padding:4px 8px;color:#d97706;">
              ${"★".repeat(v.rating)} ${v.rating}/5
              ${v.rating_comment
                ? `<span style="color:#6b7280;font-style:italic;
                  margin-left:6px;">
                  "${v.rating_comment}"
                  </span>` : ""}
            </td>
          </tr>` : ""}
          ${v.notes ? `
          <tr>
            <td style="padding:4px 8px;color:#6b7280;">
              Notes
            </td>
            <td style="padding:4px 8px;font-style:italic;
              color:#6b7280;">"${v.notes}"</td>
          </tr>` : ""}
          ${v.gate ? `
          <tr>
            <td style="padding:4px 8px;color:#6b7280;">
              Gate
            </td>
            <td style="padding:4px 8px;">${v.gate}</td>
          </tr>` : ""}
        </table>
        ${incidentsHtml}
        ${photosHtml}
      </div>`;
      }).join("");

      const html = `<!DOCTYPE html><html><head>
      <meta charset="UTF-8">
      <style>
        *{margin:0;padding:0;box-sizing:border-box;}
        body{font-family:Arial,sans-serif;color:#111827;
          font-size:13px;}
        .header{background:#0F2044;color:white;
          padding:28px 32px;}
        .header h1{font-size:26px;font-weight:900;}
        .header p{opacity:0.8;margin-top:4px;font-size:14px;}
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
        .footer{padding:20px 32px;text-align:center;
          color:#6b7280;font-size:11px;
          border-top:1px solid #e5e7eb;
          line-height:1.6;}
        .footer-plate{font-size:18px;font-weight:900;
          color:#0F2044;letter-spacing:2px;
          margin-bottom:8px;}
        .footer-disclaimer{font-size:10px;color:#6b7280;
          max-width:560px;margin:12px auto 0;
          line-height:1.5;}
      </style></head><body>
      <div class="header">
        <h1>${data.plate}</h1>
        <p>${data.color} ${data.make}</p>
        <p style="margin-top:8px;font-size:11px;opacity:0.6;">
          Official Vehicle Custody Report
        </p>
      </div>

      <div class="section">
        <h2>Summary</h2>
        <div class="stats">
          ${[
            ["Total Visits", data.total_visits],
            ["Delivered", data.total_delivered],
            ["Incidents", data.total_incidents],
            ["Avg Duration", data.avg_duration_minutes > 0
              ? data.avg_duration_minutes + " min" : "—"],
          ].map(([label, value]) => `
            <div class="stat">
              <div class="stat-val">${value}</div>
              <div class="stat-lbl">${label}</div>
            </div>`
          ).join("")}
        </div>
      </div>

      <div class="section">
        <h2>Visit History (${data.visits.length})</h2>
        ${visitRows}
      </div>

      <div class="footer">
        <div class="footer-plate">${data.plate}</div>
        <div>Generated: ${generatedAt}</div>
        <p class="footer-disclaimer">
          This report is an official record generated by InstaPark
          Valet Management System. It may be presented to law
          enforcement or legal authorities as evidence of vehicle
          custody.
        </p>
        <div style="margin-top:12px;color:#9ca3af;">
          InstaPark — Smart Valet Operations ·
          Vehicle Report for ${data.plate}
        </div>
      </div>
    </body></html>`;

      const w = window.open("", "_blank");
      w.document.write(html);
      w.document.close();
      setTimeout(() => w.print(), 500);
      toast.success("Vehicle report ready to print/save");
    } catch {
      toast.error("Failed to generate vehicle report");
    }
  };

  if (loading) return <OwnerLayout title="Car Detail"><div className="p-8 text-center text-gray-400">Loading car history…</div></OwnerLayout>;
  if (!data) return <OwnerLayout title="Car Detail"><div className="p-8 text-center text-gray-400">No records found for this plate.</div></OwnerLayout>; 
  const totalIncidentCount = Object.values(incidentsMap).reduce(
    (sum, list) => sum + (Array.isArray(list) ? list.length : 0),
    0
  );
 
  return ( 
    <OwnerLayout title="Car Detail"> 
      <div className="flex items-center justify-between mb-6">
        <Link to="/provider/cars" className="inline-flex items-center gap-1.5 text-sm text-[#1A3C6E] hover:underline">
          <ArrowLeft className="w-4 h-4" /> Back to Cars Registry
        </Link>
        <button
          onClick={generateCarPDF}
          className="flex items-center gap-2 px-4 py-2 rounded-xl
            border border-purple-200 text-purple-700 bg-purple-50
            hover:bg-purple-100 transition text-sm font-semibold"
        >
          <Download className="w-4 h-4" />
          Download Report
        </button>
      </div>
 
      <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-5 mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="max-w-xs w-full mx-auto md:mx-0">
            <div className="bg-white border-2 border-blue-700 rounded-lg px-4 py-3 text-center">
              <div className="font-mono-plate text-3xl font-bold tracking-widest text-[#0F2044]">
                {data.plate}
              </div>
            </div>
          </div>
          <div className="flex-1">
            <div className="text-lg font-semibold text-[#0F2044]">
              {data.make} · {data.color}
            </div>
            <div className="text-sm text-gray-500 mt-1">Total Visits: {data.visits.length}</div>
            {data.visits.length > 1 && (
              <span className="mt-3 inline-flex items-center gap-1.5 bg-amber-100 text-amber-700 rounded-full text-xs font-semibold px-2.5 py-1">
                <Star className="w-3.5 h-3.5 fill-amber-500" />
                {data.visits.length} visits
              </span>
            )}
          </div>
        </div>
      </div>

      {totalIncidentCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
          <div>
            <p className="text-red-700 font-bold text-sm">Incidents Reported</p>
            <p className="text-red-600 text-sm">{totalIncidentCount} incident{totalIncidentCount === 1 ? "" : "s"} across all visits</p>
          </div>
        </div>
      )}
 
      {/* Legal notice banner */} 
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6 flex items-start gap-2"> 
        <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" /> 
        <p className="text-xs text-amber-800 font-medium"> 
          This record contains complete valet history for plate <strong>{data.plate}</strong>. 
          All data is timestamped and driver-attributed. Available for law enforcement or legal purposes upon request. 
        </p> 
      </div> 
 
      {/* Visit History */} 
      <h2 className="font-heading text-xl font-bold text-[#0F2044] mb-4">Visit History</h2> 
      <div className="space-y-4"> 
        {data.visits.map((v, i) => ( 
          <div key={v.car_id} className="relative"> 
            {i < data.visits.length - 1 && (
              <div className="absolute left-3 top-8 bottom-[-20px] w-0.5 bg-gray-200" />
            )}
            <div className={`absolute left-0 top-5 w-6 h-6 rounded-full border-2 ${
              v.status === "DELIVERED"
                ? "bg-emerald-500 border-emerald-100"
                : "bg-amber-500 border-amber-100"
            }`} />
            <div className={`ml-10 bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden ${expandedVisit === i ? "ring-1 ring-[#1A3C6E]/20" : ""}`}> 
              {/* Visit header — always visible */} 
              <button 
                onClick={() => setExpandedVisit(expandedVisit === i ? null : i)} 
                className="w-full text-left p-5 hover:bg-gray-50 transition"> 
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1"> 
                    <div className="flex items-center gap-2 flex-wrap"> 
                      <span className="font-heading font-bold text-[#0F2044]">{v.event_name}</span> 
                      <StatusBadge status={v.status} />
                      {v.car_type === "premium" && (
                        <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                          PREMIUM
                        </span>
                      )}
                    </div> 
                    <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 mt-3 text-xs text-gray-600">
                      <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{v.event_date || "—"}</span>
                      <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{v.zone ? `Zone ${v.zone} / Slot ${v.slot}` : "Slot —"}</span>
                      <span>Check-in: {v.check_in_time ? fmtDateTime(v.check_in_time) : "—"}</span>
                      <span>Parked: {v.parked_at ? fmtDateTime(v.parked_at) : "—"}</span>
                      <span>Delivered: {v.delivered_at ? fmtDateTime(v.delivered_at) : "—"}</span>
                      <span>Drivers: {v.check_in_driver || "—"} / {v.parked_by || "—"} / {v.retrieved_by || "—"}</span>
                      <span>Gate: {v.gate || "—"}</span>
                    </div>
                    {v.photos?.length > 0 && (
                      <div className="flex gap-2 mt-3 flex-wrap">
                        {v.photos.slice(0, 4).map((p, pi) => (
                          <img
                            key={pi}
                            src={p.url}
                            alt={p.type}
                            onClick={(e) => { e.stopPropagation(); setLightbox(p.url); }}
                            className="w-12 h-12 object-cover rounded-lg border border-gray-200 cursor-pointer hover:opacity-80 transition"
                          />
                        ))}
                      </div>
                    )}
                  </div> 
                </div>
              </button> 
 
              {/* Expanded visit details */} 
              {expandedVisit === i && ( 
                <div className="border-t border-gray-100 px-5 py-4 bg-gray-50/50"> 
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4 mb-6 pb-6 border-b border-gray-100">
                    {[
                      { label: "Guest Name", value: v.guest_name },
                      { label: "Guest Phone", value: v.guest_phone },
                      { label: "Alternate Phone", value: v.alt_guest_phone },
                      {
                        label: "Key Tag",
                        value: (["PARKED", "RETRIEVAL_REQUESTED", "ACCEPTED", "BEING_FETCHED", "WAITING_AT_GATE", "REPARKING"].includes(v.status) && v.key_tag)
                          ? `#${v.key_tag}`
                          : null
                      },
                      { label: "Car Type", value: v.car_type === "premium" ? "Premium" : null },
                      { label: "Duration", value: v.duration_minutes ? `${v.duration_minutes} min` : null },
                      { label: "Time to Park", value: v.park_minutes != null ? fmtDuration(v.park_minutes) : null },
                      { label: "Retrieval → Gate", value: v.retrieval_to_gate_minutes != null ? fmtDuration(v.retrieval_to_gate_minutes) : null },
                      { label: "Gate Wait", value: v.gate_wait_minutes != null ? fmtDuration(v.gate_wait_minutes) : null },
                      { label: "Re-park Time", value: v.repark_minutes != null ? fmtDuration(v.repark_minutes) : null },
                      { label: "Notes", value: v.notes },
                    ].filter(f => f.value && f.value !== "").map((f) => (
                      <div key={f.label}>
                        <div className="text-[10px] uppercase font-bold text-gray-400">
                          {f.label}
                        </div>
                        <div className="text-sm font-semibold text-[#0F2044] mt-0.5">
                          {f.value}
                        </div>
                      </div>
                    ))}
                  </div>

                  {v.has_damage && (
                    <div className="bg-amber-50 border-l-4 border-amber-400 rounded-r-xl p-4 mb-4 flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
                      <div>
                        <h4 className="text-xs font-bold text-amber-800 tracking-wider">SCRATCH / DAMAGE REPORTED AT CHECK-IN</h4>
                        {v.damage_types && v.damage_types.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-2 mb-1">
                            {v.damage_types.map(dt => (
                              <span key={dt} className="px-2 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-semibold">
                                {dt}
                              </span>
                            ))}
                          </div>
                        )}
                        {v.damage_notes && (
                          <p className="text-sm text-amber-700 mt-1">{v.damage_notes}</p>
                        )}
                      </div>
                    </div>
                  )}

                  {["PARKED", "RETRIEVAL_REQUESTED", "ACCEPTED", "BEING_FETCHED", "WAITING_AT_GATE", "DELIVERED", "REPARKING"].includes(v.status) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setPathMapVisit(v.car_id); }}
                      className="text-sm font-semibold text-[#1A3C6E] hover:underline flex items-center gap-1 mb-4"
                    >
                      See Path →
                    </button>
                  )}

                  <VisitTimelineFetcher carId={v.car_id} setLightbox={setLightbox} />

                  {v.rating_platform && (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <div className="flex items-center gap-2">
                        <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                        <span className="text-sm font-bold text-amber-600">
                          {v.rating_platform}/5 Guest Rating
                        </span>
                      </div>
                      {v.rating_comment && (
                        <div className="mt-2 bg-amber-50 border-l-2 border-amber-400 rounded-r-xl px-3 py-2">
                          <p className="text-xs text-amber-800 italic">
                            "{v.rating_comment}"
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div> 
              )} 
            </div>
          </div> 
        ))} 
      </div> 

      {(() => {
        const allIncidents = Object.values(incidentsMap).flat();
        if (allIncidents.length === 0) return null;
        return (
          <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden mb-6">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              <h2 className="font-heading text-lg font-bold text-[#0F2044]">
                Incidents
                <span className="ml-2 text-sm font-normal text-gray-400">({allIncidents.length} total)</span>
              </h2>
            </div>
            <div className="overflow-x-auto w-full max-w-full">
              <table className="w-full text-sm min-w-[600px]">
                <thead className="bg-gray-50 text-gray-500 uppercase text-xs tracking-wider">
                  <tr>
                    <th className="text-left px-6 py-3">Event</th>
                    <th className="text-left px-6 py-3">Description</th>
                    <th className="text-left px-6 py-3">Type</th>
                    <th className="text-left px-6 py-3">Driver</th>
                    <th className="text-left px-6 py-3">Date</th>
                    <th className="text-left px-6 py-3">Status</th>
                    <th className="text-left px-6 py-3">Remark</th>
                  </tr>
                </thead>
                <tbody>
                  {allIncidents
                    .slice()
                    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
                    .map((inc, i) => (
                      <tr key={inc.id || i} className="border-t border-gray-100 hover:bg-[#F4F6FA] transition-colors">
                        <td className="px-6 py-4 font-semibold text-[#1A3C6E]">{inc.event_name || "â€”"}</td>
                        <td className="px-6 py-4 text-gray-600 max-w-xs truncate">{inc.description || "â€”"}</td>
                        <td className="px-6 py-4">
                          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-gray-100 text-gray-700">
                            {(inc.incident_type || "UNKNOWN").replace(/_/g, " ").replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.substr(1).toLowerCase())}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-gray-500">{inc.driver_name || "â€”"}</td>
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
                          ) : "â€”"}
                        </td>
                        <td className="px-6 py-4 text-gray-500 max-w-xs truncate" title={inc.remark || ""}>
                          {inc.remark || "â€”"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* Lightbox Overlay */}
      {lightbox && (
        <div 
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={() => setLightbox(null)}
        >
          <button 
            className="absolute top-6 right-6 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 p-2 rounded-full transition-colors z-[60]"
            onClick={() => setLightbox(null)}
          >
            <X className="w-6 h-6" />
          </button>
          <img 
            src={lightbox} 
            alt="Enlarged view" 
            className="max-h-[90vh] max-w-[90vw] object-contain rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {pathMapVisit && (
        <DriverPathMap carId={pathMapVisit} onClose={() => setPathMapVisit(null)} />
      )}
    </OwnerLayout> 
  ); 
}

