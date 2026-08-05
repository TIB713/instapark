import { useEffect, useState, useRef } from "react";
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/time";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// Auto-pan map to follow driver's latest position
function MapFollower({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.panTo(position, { animate: true });
  }, [position, map]);
  return null;
}

const JOURNEY_COLORS = {
  checkin: "#1D4ED8",
  parked: "#059669",
  retrieval: "#D97706",
  delivered: "#7C3AED",
  idle: "#6B7280",
};

const JOURNEY_LABELS = {
  checkin: "Checking in car",
  parked: "Parking car",
  retrieval: "Fetching car for guest",
  delivered: "Delivering car",
  idle: "Idle",
};

export default function LiveDriverMap({ driverId, driverName, eventId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef(null);

  const fetchTrail = async () => {
    try {
      const { data: res } = await api.get(
        `/superadmin/drivers/${driverId}/live-trail`,
        { params: { event_id: eventId } }
      );
      setData(res);
    } catch {
      // silently fail — keep showing last known state
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!driverId || !eventId) return;
    fetchTrail();
    intervalRef.current = setInterval(fetchTrail, 5000);
    return () => clearInterval(intervalRef.current);
  }, [driverId, eventId]);

  if (!driverId) return null;

  const trail = data?.trail || [];
  const positions = trail.map(p => [p.lat, p.lng]);
  const latestPos = positions.length > 0 ? positions[positions.length - 1] : null;
  const center = latestPos || [23.0225, 72.5714];
  const journeyType = data?.journey_type || "idle";
  const currentCar = data?.current_car || null;
  const trailColor = JOURNEY_COLORS[journeyType] || "#6B7280";
  const journeyLabel = JOURNEY_LABELS[journeyType] || "Idle";

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-[#0F2044]">{driverName} — Live Tracking</h3>
            <p className="text-xs text-gray-400 mt-0.5">Updates every 5 seconds</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>

        {/* Journey context banner */}
        {!loading && (
          <div className={`px-4 py-3 border-b border-gray-100 flex items-center justify-between`}>
            <div className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full inline-block"
                style={{ backgroundColor: trailColor }}
              />
              <span className="text-sm font-semibold text-[#0F2044]">{journeyLabel}</span>
            </div>
            {currentCar ? (
              <div className="text-right">
                <span className="text-xs font-mono font-bold text-[#0F2044]">{currentCar.plate}</span>
                <span className="text-xs text-gray-400 ml-2">{currentCar.color} {currentCar.make}</span>
              </div>
            ) : (
              <span className="text-xs text-gray-400">No active car</span>
            )}
          </div>
        )}

        {/* Map */}
        <div className="flex-1 min-h-[400px]">
          {loading ? (
            <div className="flex items-center justify-center h-full text-gray-400">Loading live trail...</div>
          ) : !latestPos ? (
            <div className="flex items-center justify-center h-full text-gray-400">No location data yet.</div>
          ) : (
            <MapContainer center={center} zoom={18} style={{ height: "100%", width: "100%", minHeight: "400px" }}>
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; OpenStreetMap contributors'
              />
              <MapFollower position={latestPos} />
              {positions.length > 1 && (
                <Polyline positions={positions} color={trailColor} weight={4} opacity={0.8} />
              )}
              {positions.length > 0 && (
                <Marker position={positions[0]}>
                  <Popup>Journey start — {fmtDateTime(trail[0]?.timestamp)}</Popup>
                </Marker>
              )}
              {latestPos && (
                <Marker position={latestPos}>
                  <Popup>
                    <strong>{driverName}</strong><br />
                    {journeyLabel}<br />
                    {currentCar ? `${currentCar.color} ${currentCar.make} · ${currentCar.plate}` : "No active car"}<br />
                    {fmtDateTime(data?.latest?.timestamp)}
                  </Popup>
                </Marker>
              )}
            </MapContainer>
          )}
        </div>

        {/* Footer — last updated */}
        {!loading && data?.latest?.timestamp && (
          <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-400 text-right">
            Last updated: {fmtDateTime(data.latest.timestamp)}
          </div>
        )}
      </div>
    </div>
  );
}
