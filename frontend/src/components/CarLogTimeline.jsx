import { FileText, Clock, LogIn, Car, Bell, MapPin, AlertCircle, CheckCircle, User, ArrowLeftRight, Image as ImageIcon } from "lucide-react";
import { fmtDateTime, fmtDuration } from "@/lib/time";

const STATUS_CONFIG = { 
  REGISTERED: { color: "#6366F1", icon: FileText, label: "Registered" },
  PRE_REGISTERED: { color: "#8B5CF6", icon: Clock, label: "Pre-Registered" }, 
  CHECKED_IN:     { color: "#0EA5E9", icon: LogIn, label: "Checked In" }, 
  PARKED:         { color: "#10B981", icon: Car, label: "Parked" }, // emerald-500
  RETRIEVAL_REQUESTED: { color: "#F59E0B", icon: Bell, label: "Retrieval Requested" }, 
  ACCEPTED: { color: "#EAB308", icon: Car, label: "Retrieval Accepted" },
  BEING_FETCHED:  { color: "#F97316", icon: User, label: "Being Fetched" }, 
  ARRIVED_AT_GATE: { color: "#10B981", icon: MapPin, label: "Arrived At Gate" },
  AWAITING_REPARK: { color: "#EF4444", icon: AlertCircle, label: "Needs Re-Park" }, // red-500
  SELF_PICKUP: { color: "#F59E0B", icon: User, label: "Self Pickup" }, // amber-500
  DELIVERED:      { color: "#9CA3AF", icon: CheckCircle, label: "Delivered" }, // gray-400
};

const STATUS_ORDER = [
  "REGISTERED", "PRE_REGISTERED", "CHECKED_IN", "PARKED",
  "RETRIEVAL_REQUESTED", "ACCEPTED", "BEING_FETCHED", "SELF_PICKUP", "DELIVERED",
];

function fmt(iso) {
  if (!iso) return "—";
  return fmtDateTime(iso);
}

function TimelineStep({ color, icon: Icon, label, time, driver, note, durationCaption, photos, isLast, onPhotoPress, rating_comment }) {
  return (
    <div className="flex">
      {/* Line + dot */}
      <div className="w-10 flex flex-col items-center">
        <div 
          className="w-9 h-9 rounded-full flex items-center justify-center z-10 text-white shadow-sm"
          style={{ backgroundColor: color }}
        >
          <Icon className="w-4 h-4" />
        </div>
        {!isLast && (
          <div className="w-0.5 flex-1 min-h-[24px] bg-gray-200 mt-0.5" />
        )}
      </div>

      {/* Content */}
      <div className={`flex-1 pl-3.5 ${isLast ? '' : 'pb-6'}`}>
        <div className="flex justify-between items-center">
          <span className="font-black text-[15px] text-gray-900">{label}</span>
          <span className="text-[11px] text-gray-500 font-bold">{fmt(time)}</span>
        </div>

        {driver && (
          <div className="flex items-center mt-1 text-gray-500">
            <User className="w-3 h-3" />
            <span className="text-[12px] ml-1 font-bold">{driver}</span>
          </div>
        )}

        {note && (
          <div className="bg-amber-50 rounded-lg p-2.5 mt-2 border-l-4 border-amber-500">
            <span className="text-amber-600 text-[12px] italic">"{note}"</span>
          </div>
        )}

        {durationCaption && (
          <div className="text-gray-500 text-[12px] mt-1 italic">
            {durationCaption}
          </div>
        )}

        {photos && photos.length > 0 && (
          <div className="flex gap-2 mt-2.5 overflow-x-auto pb-1">
            {photos.map((url, i) => (
              <img 
                key={i}
                src={url}
                alt="Documentation"
                onClick={() => onPhotoPress?.(url)}
                className="w-20 h-20 rounded-xl border-2 border-gray-200 object-cover cursor-pointer hover:opacity-80 transition flex-shrink-0"
              />
            ))}
          </div>
        )}

        {rating_comment && (
          <div className="bg-emerald-50 rounded-lg p-2.5 mt-2 border-l-4 border-emerald-500 ml-12 mb-6">
            <span className="text-emerald-600 text-[12px] italic">"{rating_comment}"</span>
          </div>
        )}
      </div>
    </div>
  );
}

function IncidentStep({ incident, isLast, onPhotoPress }) {
  const typeFormat = (incident.incident_type || "UNKNOWN").replace(/_/g, " ").replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.substr(1).toLowerCase());
  const isResolved = incident.status === "RESOLVED" || incident.status === "DISMISSED";
  const color = isResolved ? "#10B981" : "#EF4444"; // emerald vs red

  return (
    <div className="flex">
      <div className="w-10 flex flex-col items-center">
        <div 
          className="w-9 h-9 rounded-full flex items-center justify-center z-10 text-white shadow-sm"
          style={{ backgroundColor: color }}
        >
          <AlertCircle className="w-4 h-4" />
        </div>
        {!isLast && (
          <div className="w-0.5 flex-1 min-h-[24px] bg-gray-200 mt-0.5" />
        )}
      </div>

      <div className={`flex-1 pl-3.5 ${isLast ? '' : 'pb-6'}`}>
        <div className="flex justify-between items-center">
          <span className="font-black text-[15px]" style={{ color }}>
            {typeFormat} Incident
          </span>
          <span className="text-[11px] text-gray-500 font-bold">{fmt(incident.created_at)}</span>
        </div>
        <div className="flex items-center mt-1 text-gray-500">
          <User className="w-3 h-3" />
          <span className="text-[12px] ml-1 font-bold">Reported by {incident.driver_name || "Unknown"}</span>
        </div>
        <div className="bg-red-50 rounded-lg p-2.5 mt-2 border-l-4 border-red-500">
          <span className="text-red-700 text-[12px]">{incident.description}</span>
        </div>
        {isResolved && incident.remark && (
          <div className="bg-gray-50 rounded-lg p-2 mt-1.5 border border-gray-200 flex flex-col gap-1">
            <span className="text-gray-700 text-[11px] italic">"{incident.remark}"</span>
            <span className="text-gray-400 text-[10px] font-bold">Resolved by {incident.resolved_by || "Unknown"}</span>
          </div>
        )}
        {incident.photo_url && (
          <div className="mt-2.5">
            <img 
              src={incident.photo_url}
              alt="Incident"
              onClick={() => onPhotoPress?.(incident.photo_url)}
              className="w-20 h-20 rounded-xl border-2 border-gray-200 object-cover cursor-pointer hover:opacity-80 transition"
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default function CarLogTimeline({ log, setLightbox }) {
  if (!log || !log.car) return null;

  const { car, drivers_map = {}, photos_by_type = {}, incidents = [] } = log;
  const { park_minutes, fetch_minutes, gate_wait_minutes, repark_minutes, retrieval_to_gate_minutes } = log;

  const steps = [];

  if (car.created_at) { 
    const registeredNote = !car.registered_by && car.guest_name
      ? `${car.guest_name}${car.guest_phone ? " · " + car.guest_phone : ""}`
      : null;
    steps.push({
      type: "status",
      status: "REGISTERED",
      time: car.created_at,
      driver: car.registered_by?.name
        ? `${car.registered_by.name}${car.registered_by.role ? ` (${car.registered_by.role})` : ""}`
        : null,
      note: registeredNote,
      photos: [],
    });
  } 

  if (car.check_in_time) { 
    steps.push({ type: "status", status: "CHECKED_IN", 
      time: car.driver_pickup_confirmed_at || car.check_in_time, 
      driver: drivers_map[car.check_in_driver_id], 
      note: car.notes || null, 
      photos: photos_by_type["checkin"] || [] }); 
  } 

  if (car.parked_at) { 
    const parkNote = [ 
      car.zone ? `Zone ${car.zone} · Slot ${car.slot}` : null, 
      car.key_tag ? `Key Tag #${car.key_tag}` : null, 
    ].filter(Boolean).join("  ·  "); 

    let durationCaption = null;
    if (car.awaiting_repark_at && new Date(car.parked_at) > new Date(car.awaiting_repark_at)) {
      if (repark_minutes != null) durationCaption = `Re-parked in ${fmtDuration(repark_minutes)}`;
    } else {
      if (park_minutes != null) durationCaption = `${fmtDuration(park_minutes)} after check-in`;
    }

    steps.push({ type: "status", status: "PARKED", 
      time: car.parked_at, 
      driver: drivers_map[car.parked_driver_id], 
      note: parkNote || null, 
      durationCaption,
      photos: photos_by_type["parked"] || [] }); 
  } 

  if (car.retrieval_requested_at) {
    let retrievalNote = "Guest scanned QR code to request retrieval";
    if (car.retrieval_requested_via === "supervisor_scan" && car.retrieval_requested_by) {
      const roleLabel = car.retrieval_requested_by.role
        ? car.retrieval_requested_by.role.charAt(0).toUpperCase() + car.retrieval_requested_by.role.slice(1)
        : "Staff";
      retrievalNote = `Requested by ${roleLabel} ${car.retrieval_requested_by.name || "Unknown"}`;
    }
    steps.push({ type: "status", status: "RETRIEVAL_REQUESTED",
      time: car.retrieval_requested_at,
      note: retrievalNote, photos: [] });
  }

  if (car.retrieval_driver_id) {
    if (car.accepted_at) {
      steps.push({ type: "status", status: "ACCEPTED",
        time: car.accepted_at,
        driver: drivers_map[car.retrieval_driver_id],
        photos: [] });
    }
    if (car.being_fetched_at) {
      steps.push({ type: "status", status: "BEING_FETCHED",
        time: car.being_fetched_at,
        driver: drivers_map[car.retrieval_driver_id],
        photos: [] });
    }
  }

  if (car.gate_arrival_time) {
    steps.push({ type: "status", status: "ARRIVED_AT_GATE",
      time: car.gate_arrival_time,
      driver: drivers_map[car.retrieval_driver_id],
      durationCaption: fetch_minutes != null ? `${fmtDuration(fetch_minutes)} after driver picked up` : null,
      photos: [] });
  }

  if (car.awaiting_repark_at) {
    steps.push({ type: "status", status: "AWAITING_REPARK",
      time: car.awaiting_repark_at,
      note: "Guest didn't arrive in time — car needs to be re-parked",
      photos: [] });
  }

  if (car.status === "DELIVERED") {
    if (car.delivery_type === "self_pickup") {
      steps.push({ type: "status", status: "SELF_PICKUP",
        time: car.delivered_at,
        driver: car.self_pickup_marked_by?.name
          ? `${car.self_pickup_marked_by.name}${car.self_pickup_marked_by.role ? ` (${car.self_pickup_marked_by.role})` : ""}`
          : null,
        note: "Guest picked up the car themselves — no driver retrieval needed",
        photos: photos_by_type["handover"] || [],
        rating_comment: log.rating_comment || null });
    } else {
      steps.push({ type: "status", status: "DELIVERED",
        time: car.delivered_at,
        driver: drivers_map[car.retrieval_driver_id],
        durationCaption: gate_wait_minutes != null ? `${fmtDuration(gate_wait_minutes)} at the gate` : null,
        photos: photos_by_type["handover"] || [],
        rating_comment: log.rating_comment || null });
    }
  }

  // Interleave incidents
  incidents.forEach(inc => {
    steps.push({ type: "incident", incident: inc, time: inc.created_at });
  });

  // Interleave assignment history
  (log.assignment_history || []).forEach(a => {
    steps.push({
      type: "assignment",
      assignment: a,
      time: a.created_at,
    });
  });

  // Sort steps
  steps.sort((a, b) => {
    const ta = a.time ? new Date(a.time).getTime() : null;
    const tb = b.time ? new Date(b.time).getTime() : null;
    if (ta !== null && tb !== null) return ta - tb;
    if (ta !== null) return -1;
    if (tb !== null) return 1;
    const oa = STATUS_ORDER.indexOf(a.status ?? "");
    const ob = STATUS_ORDER.indexOf(b.status ?? "");
    return (oa === -1 ? 99 : oa) - (ob === -1 ? 99 : ob);
  });

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h3 className="text-[11px] font-black text-gray-400 tracking-[3px] mb-6">VEHICLE TIMELINE</h3>
      <div className="flex flex-col">
        {steps.map((step, i) => {
          const isLast = i === steps.length - 1;
          
          if (step.type === "incident") {
            return <IncidentStep key={`inc-${i}`} incident={step.incident} isLast={isLast} onPhotoPress={setLightbox} />;
          }

          if (step.type === "assignment") {
            const a = step.assignment;
            const isSelf = a.source === "self";
            const label = isSelf 
              ? `${a.driver_name} self-checked-in`
              : `${a.action === 'reassigned' ? 'Reassigned' : 'Assigned'} to ${a.driver_name} by ${a.performed_by?.name || "System"} (${a.performed_by?.role || "admin"})`;
            const subtitle = a.previous_driver_id && drivers_map[a.previous_driver_id] 
              ? `Previously: ${drivers_map[a.previous_driver_id]}`
              : null;
            
            return (
              <TimelineStep
                key={`asg-${i}`}
                color="#8B5CF6"
                icon={ArrowLeftRight}
                label={label}
                time={step.time}
                note={subtitle}
                isLast={isLast}
              />
            );
          }

          const scfg = STATUS_CONFIG[step.status];
          if (!scfg) return null;

          return (
            <TimelineStep
              key={`step-${i}`}
              color={scfg.color}
              icon={scfg.icon}
              label={scfg.label}
              time={step.time}
              driver={step.driver}
              note={step.note}
              durationCaption={step.durationCaption}
              photos={step.photos}
              rating_comment={step.rating_comment}
              isLast={isLast}
              onPhotoPress={setLightbox}
            />
          );
        })}
        {steps.length === 0 && (
          <div className="text-sm text-gray-500 italic text-center py-4">No timeline events recorded yet.</div>
        )}
      </div>
    </div>
  );
}
