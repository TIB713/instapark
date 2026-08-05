import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Polyline, Marker, Popup } from "react-leaflet";
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

export default function DriverPathMap({ carId, onClose }) {
  const [data, setData] = useState(null);
  const [leg, setLeg] = useState("checkin_to_park");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!carId) return;
    setLoading(true);
    api.get(`/cars/${carId}/driver-path`)
      .then(({ data }) => {
        setData(data);
        const hasCheckin = (data.checkin_to_park || []).length > 0;
        const hasRetrieval = (data.park_to_gate || []).length > 0;
        if (!hasCheckin && hasRetrieval) {
          setLeg("park_to_gate");
        } else {
          setLeg("checkin_to_park");
        }
      })
      .finally(() => setLoading(false));
  }, [carId]);

  if (!carId) return null;

  const activePings = data?.[leg] || [];
  const positions = activePings.map(p => [p.lat, p.lng]);
  const center = positions.length > 0 ? positions[Math.floor(positions.length / 2)] : [23.0225, 72.5714];

  const hasCheckin = (data?.checkin_to_park || []).length > 0;
  const hasRetrieval = (data?.park_to_gate || []).length > 0;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <h3 className="font-bold text-[#0F2044]">Driver Path</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>

        {!loading && hasCheckin && hasRetrieval && (
          <div className="flex gap-2 p-4 border-b border-gray-100">
            <button
              onClick={() => setLeg("checkin_to_park")}
              className={`px-4 py-2 rounded-lg text-sm font-semibold ${leg === "checkin_to_park" ? "bg-[#0F2044] text-white" : "bg-gray-100 text-gray-600"}`}
            >
              Check-in → Park
            </button>
            <button
              onClick={() => setLeg("park_to_gate")}
              className={`px-4 py-2 rounded-lg text-sm font-semibold ${leg === "park_to_gate" ? "bg-[#0F2044] text-white" : "bg-gray-100 text-gray-600"}`}
            >
              Park → Gate
            </button>
          </div>
        )}

        {!loading && (hasCheckin || hasRetrieval) && !(hasCheckin && hasRetrieval) && (
          <div className="p-4 border-b border-gray-100">
            <span className="text-sm font-semibold text-gray-500">
              {hasCheckin ? "Check-in → Park" : "Park → Gate"} path
            </span>
          </div>
        )}

        <div className="flex-1 min-h-[400px]">
          {loading ? (
            <div className="flex items-center justify-center h-full text-gray-400">Loading path...</div>
          ) : positions.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400">No GPS data for this leg.</div>
          ) : (
            <MapContainer center={center} zoom={18} style={{ height: "100%", width: "100%", minHeight: "400px" }}>
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; OpenStreetMap contributors'
              />
              <Polyline positions={positions} color={leg === "checkin_to_park" ? "#0F2044" : "#059669"} weight={4} />
              {positions.length > 0 && (
                <Marker position={positions[0]}>
                  <Popup>Start — {fmtDateTime(activePings[0]?.timestamp)}</Popup>
                </Marker>
              )}
              {positions.length > 1 && (
                <Marker position={positions[positions.length - 1]}>
                  <Popup>End — {fmtDateTime(activePings[activePings.length - 1]?.timestamp)}</Popup>
                </Marker>
              )}
            </MapContainer>
          )}
        </div>
      </div>
    </div>
  );
}
