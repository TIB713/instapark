import { useEffect, useRef, useState } from "react"; 
import { useParams, useNavigate } from "react-router-dom"; 
import { api, WS_BASE } from "@/lib/api"; 
import { Car, MapPin, Calendar, Clock, Loader2, User } from "lucide-react"; 
import QRCode from "react-qr-code"; 

export default function PassView() { 
  const { passToken } = useParams(); 
  const nav = useNavigate(); 
  const [pass, setPass] = useState(null); 
  const [loading, setLoading] = useState(true); 
  const [invalid, setInvalid] = useState(false); 
  const wsRef = useRef(null); 

  useEffect(() => { 
    api.get(`/pass/${passToken}`) 
      .then(r => { setPass(r.data); setLoading(false); }) 
      .catch(() => { setInvalid(true); setLoading(false); }); 
  }, [passToken]); 

  // WebSocket — when status changes from PRE_REGISTERED, 
  // redirect to GuestView (retrieval page) 
  useEffect(() => { 
    if (!pass?.car_id) return; 
    try { 
      const ws = new WebSocket(`${WS_BASE}/ws/car/${pass.car_id}`); 
      ws.onmessage = (e) => { 
        try { 
          const msg = JSON.parse(e.data); 
          if (msg.type === "car_update" && msg.data?.id === pass.car_id) { 
            if (msg.data.status !== "PRE_REGISTERED") { 
              // Car has been checked in — redirect to retrieval page 
              nav(`/v/${passToken}`, { replace: true }); 
            } 
          } 
        } catch {} 
      }; 
      wsRef.current = ws; 
      return () => { try { ws.close(); } catch {} }; 
    } catch {} 
  }, [pass?.car_id, passToken, nav]); 

  if (loading) return ( 
    <div className="min-h-screen bg-gradient-to-br from-[#0F2044] to-[#1A3C6E] flex items-center justify-center"> 
      <Loader2 className="w-10 h-10 text-white animate-spin" /> 
    </div> 
  ); 

  if (invalid || !pass) return ( 
    <div className="min-h-screen bg-gradient-to-br from-[#0F2044] to-[#1A3C6E] flex items-center justify-center p-4"> 
      <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center"> 
        <h1 className="font-bold text-xl text-gray-800 mb-2">Invalid Pass</h1> 
        <p className="text-gray-500 text-sm">This pass is not valid or has expired.</p> 
      </div> 
    </div> 
  ); 

  // If already checked in (not PRE_REGISTERED), redirect to retrieval page 
  if (pass.status !== "PRE_REGISTERED") { 
    nav(`/v/${passToken}`, { replace: true }); 
    return null; 
  } 

  const passUrl = `${window.location.origin}/pass/${passToken}`; 

  return ( 
    <div className="min-h-screen bg-gradient-to-br from-[#0F2044] to-[#1A3C6E] flex items-center justify-center p-4"> 
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden"> 
        {/* Header */} 
        <div className="bg-gradient-to-r from-[#0F2044] to-[#1A3C6E] p-5 text-white text-center"> 
          <div className="w-12 h-12 bg-white/20 rounded-xl mx-auto flex items-center justify-center mb-2"> 
            <Car className="w-6 h-6 text-white" /> 
          </div> 
          <h1 className="font-bold text-lg">Vehicle Pre-Registration Pass</h1> 
          <p className="text-white/70 text-xs mt-0.5">{pass.event_name}</p> 
        </div> 

        {/* QR Code */} 
        <div className="flex flex-col items-center pt-6 pb-4 px-6"> 
          <div className="bg-white p-3 rounded-2xl shadow-lg border border-gray-100"> 
            <QRCode value={passUrl} size={180} /> 
          </div> 
          <p className="text-xs text-gray-400 mt-3 text-center"> 
            Show this QR code to the valet attendant at the gate 
          </p> 
        </div> 

        {/* Instructions banner */} 
        <div className="mx-4 mb-4 bg-amber-50 border border-amber-200 rounded-2xl p-3"> 
          <p className="text-xs font-bold text-amber-700 mb-1">📸 Important</p> 
          <p className="text-xs text-amber-800"> 
            Please wait while the valet photographs your vehicle. 
            This protects you against any damage claims and takes under 30 seconds. 
          </p> 
        </div> 

        {/* Car Details */} 
        <div className="px-4 pb-4 space-y-2"> 
          <div className="bg-gray-50 rounded-2xl p-4"> 
            <div className="flex items-center gap-2 mb-3"> 
              <User className="w-4 h-4 text-gray-400" /> 
              <span className="font-semibold text-sm text-[#0F2044]">{pass.guest_name}</span> 
            </div> 
            <div className="grid grid-cols-2 gap-2 text-xs text-gray-600"> 
              <div> 
                <span className="font-bold text-gray-400 uppercase tracking-wider text-[10px]">Plate</span> 
                <p className="font-mono font-bold text-[#0F2044] text-sm mt-0.5">{pass.plate}</p> 
              </div> 
              <div> 
                <span className="font-bold text-gray-400 uppercase tracking-wider text-[10px]">Vehicle</span> 
                <p className="font-semibold text-[#0F2044] mt-0.5">{pass.color} {pass.make}</p> 
              </div> 
              <div className="flex items-center gap-1 mt-1"> 
                <MapPin className="w-3 h-3 text-gray-400" /> 
                <span>{pass.event_venue}</span> 
              </div> 
              <div className="flex items-center gap-1 mt-1"> 
                <Calendar className="w-3 h-3 text-gray-400" /> 
                <span>{pass.event_name}</span> 
              </div> 
              {pass.expected_arrival && ( 
                <div className="flex items-center gap-1 col-span-2 mt-1"> 
                  <Clock className="w-3 h-3 text-gray-400" />
                  <span>Arriving: {new Date(pass.expected_arrival).toLocaleTimeString("en-IN", {hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata"})}</span> 
                </div> 
              )} 
            </div> 
          </div> 

          <p className="text-center text-xs text-gray-400 pb-2"> 
            After check-in, this page will automatically update to your car retrieval screen 🚗 
          </p> 
        </div> 
      </div> 
    </div> 
  ); 
} 
