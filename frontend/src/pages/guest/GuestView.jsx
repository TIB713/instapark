import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { api, API, WS_BASE } from "@/lib/api";
import { fmtTime } from "@/lib/time";
import { Car, CheckCircle2, Clock, Star, Loader2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

const publicApi = axios.create({ baseURL: API });

export default function GuestView() {
  const { token } = useParams();
  const [car, setCar] = useState(null);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);

  // Local state only for UX (button loading, show time picker), NOT for navigation
  const [requesting, setRequesting] = useState(false);
  const [showSchedulePicker, setShowSchedulePicker] = useState(false);
  const [scheduleTime, setScheduleTime] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [rated, setRated] = useState(false);
  const [platformStars, setPlatformStars] = useState(0);
  const [hoverPlatform, setHoverPlatform] = useState(0);
  const [driverStars, setDriverStars] = useState(0);
  const [hoverDriver, setHoverDriver] = useState(0);
  const [comment, setComment] = useState("");
  const [eta, setEta] = useState(null);
  const [queuePosition, setQueuePosition] = useState(null);
  const [deliveryOtp, setDeliveryOtp] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(null);

  useEffect(() => {
    let cancel = false;
    const isRetrieval = window.location.pathname.startsWith('/r/');
    api.get(isRetrieval ? `/retrieval/${token}` : `/qr/${token}`)
      .then(r => { 
        if (!cancel) { 
          setCar(r.data); 
          setLoading(false); 
          if (!isRetrieval && r.data.retrieval_token) {
            setTimeout(() => {
              window.history.replaceState(null, '', `/r/${r.data.retrieval_token}`);
            }, 50);
          }
        } 
      })
      .catch(() => { if (!cancel) { setInvalid(true); setLoading(false); } });
    return () => { cancel = true; };
  }, [token]);

  useEffect(() => {
    if (!car?.id) return;
    let ws, retryCount = 0, retryTimer;
    const connect = () => {
      const retrievalToken = car?.retrieval_token;
      ws = new WebSocket(`${WS_BASE}/ws/car/${car.id}?token=${retrievalToken}`);
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "car_update") { setCar(msg.data); }
      };
      ws.onclose = () => {
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
          const { data } = await publicApi.get(`/retrieval/${car.retrieval_token}`);
          setCar(data);
        } catch { }
      }
    }, 5000);
    return () => {
      clearTimeout(retryTimer);
      clearInterval(poll);
      ws?.close();
    };
  }, [car?.id, car?.retrieval_token, token]);

  useEffect(() => {
    if (
      car?.status === "RETRIEVAL_REQUESTED" ||
      car?.status === "BEING_FETCHED"
    ) {
      if (!eta) fetchEta(car.event_id);
      fetchQueuePosition(car.id);
    } else {
      setQueuePosition(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [car?.status]);

  useEffect(() => {
    if (car?.status !== "ARRIVED_AT_GATE") {
      setDeliveryOtp(null);
      setSecondsLeft(null);
      return;
    }
    const fetchOtp = () => {
      publicApi.get(`/retrieval/${car.retrieval_token}/delivery-otp`)
        .then(r => setDeliveryOtp(r.data.otp))
        .catch(err => {
          console.error(
            "DELIVERY OTP ERROR:",
            err.response?.status,
            err.response?.data
          );
          setDeliveryOtp(null);
        });
    };
    const otpTimer = setTimeout(fetchOtp, 500);

    const tick = () => {
      if (!car.gate_timer_expires_at) { setSecondsLeft(null); return; }
      const diff = Math.max(0, Math.floor((new Date(car.gate_timer_expires_at) - new Date()) / 1000));
      setSecondsLeft(diff);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => { clearInterval(interval); clearTimeout(otpTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [car?.status, token]);

  const handleRequestRetrieval = async () => {
    if (!car) return;
    setRequesting(true);
    try {
      const { data } = await api.patch(`/cars/${car.id}/request-retrieval?retrieval_token=${car.retrieval_token}`);
      setCar(data);
    } catch { } finally { setRequesting(false); }
  };

  const scheduleRetrieval = async () => {
    if (!scheduleTime) return;
    setScheduling(true);
    try {
      const { data } = await api.patch(
        `/cars/${car.id}/schedule-retrieval?retrieval_token=${car.retrieval_token}`,
        { scheduled_time: new Date(scheduleTime).toISOString() }
      );
      setCar(data);
      setShowSchedulePicker(false);
    } catch (err) {
      alert(err.response?.data?.detail || "Could not schedule retrieval");
    } finally {
      setScheduling(false);
    }
  };

  const cancelScheduleRetrieval = async () => {
    try {
      const { data } = await api.patch(
        `/cars/${car.id}/schedule-retrieval/cancel?retrieval_token=${car.retrieval_token}`
      );
      setCar(data);
      setShowSchedulePicker(false);
      setScheduleTime("");
    } catch { alert("Could not cancel scheduled pickup. Please try again."); }
  };

  const fetchEta = async (eventId) => {
    try {
      const { data } = await publicApi.get(`/events/${eventId}/public-stats`);
      setEta(data.avg_retrieval_minutes || 5);
    } catch {
      setEta(5);
    }
  };

  const fetchQueuePosition = async (carId) => {
    try {
      const { data } = await api.get(
        `/cars/${carId}/queue-position`
      );
      setQueuePosition(data);
    } catch { }
  };

  const getMinDateTime = () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 5);
    const offset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - offset).toISOString().slice(0, 16);
  };

  const getMaxDateTime = () => {
    const max = new Date();
    max.setHours(max.getHours() + 12);
    const offset = max.getTimezoneOffset() * 60000;
    return new Date(max.getTime() - offset).toISOString().slice(0, 16);
  };

  const rate = async () => {
    try {
      await publicApi.post(`/ratings?retrieval_token=${car.retrieval_token}`, {
        car_id: car.id,
        stars: platformStars,
        driver_stars: driverStars,
        comment: comment.trim() || null
      });
    } catch { }
    setRated(true);
  };

  if (loading) return (
    <div className="guest-bg flex items-center justify-center px-4">
      <div className="bg-white/10 backdrop-blur-md rounded-3xl p-10 flex flex-col items-center text-white">
        <Loader2 className="w-10 h-10 animate-spin" />
        <p className="mt-4 font-heading">Loading your car…</p>
      </div>
    </div>
  );

  if (invalid) return (
    <div className="guest-bg flex items-center justify-center px-4">
      <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full p-8 text-center fade-in-up" data-testid="guest-invalid">
        <div className="w-16 h-16 bg-amber-100 rounded-full mx-auto flex items-center justify-center">
          <Clock className="w-8 h-8 text-amber-600" />
        </div>
        <h1 className="font-heading text-2xl font-bold text-[#0F2044] mt-5">Invalid QR Code</h1>
        <p className="text-gray-500 mt-2 text-sm">Please see the valet attendant.</p>
      </div>
    </div>
  );

  const status = car?.status;

  // State Machine: Render the correct screen based on car data
  return (
    <div className="guest-bg">
      <div className="max-w-sm mx-auto px-4 py-8 flex flex-col gap-6 min-h-screen">
        <div className="text-center fade-in-up">
          <div className="inline-flex items-center gap-1.5 bg-white/15 text-white px-3 py-1 rounded-full text-xs backdrop-blur">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-dot" />
            <span>{car?.event_name}</span>
          </div>
          <h1 className="font-heading text-4xl font-extrabold text-white tracking-tight mt-3">INSTAPARK</h1>
          <div className="mt-3 inline-block bg-white/95 px-4 py-1.5 rounded-full">
            <span className="font-mono-plate font-bold text-[#0F2044] tracking-wider" data-testid="car-plate">{car?.plate}</span>
          </div>
          <p className="text-white/60 text-xs mt-2">{car?.color} {car?.make}</p>
        </div>

        {/* Screen 0: CHECKED_IN */}
        {status === "CHECKED_IN" && (
          <div className="bg-white rounded-3xl shadow-2xl p-8 text-center fade-in-up" data-testid="state-checked-in">
            <div className="w-20 h-20 bg-blue-100 rounded-full mx-auto flex items-center justify-center pulse-dot">
              <Car className="w-10 h-10 text-[#1A3C6E]" />
            </div>
            <h2 className="font-heading text-xl font-bold text-[#0F2044] mt-5">🔄 Your car is being parked.</h2>
            <p className="text-gray-500 text-sm mt-1">You can request retrieval once it's fully parked.</p>
            <div className="bouncing-dots mt-5"><span /><span /><span /></div>
          </div>
        )}

        {/* Screen 1 and 2: PARKED (with or without scheduled time) */}
        {status === "PARKED" && (
          <div className="bg-white rounded-3xl shadow-2xl overflow-hidden fade-in-up" data-testid="state-parked">
            {/* Screen 2: Scheduled Confirmation */}
            {car.scheduled_retrieval_time ? (
              <>
                <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 p-6 text-center text-white">
                  <div className="w-16 h-16 bg-white/20 rounded-full mx-auto flex items-center justify-center backdrop-blur">
                    <CheckCircle2 className="w-9 h-9 text-white" />
                  </div>
                  <h2 className="font-heading text-xl font-bold mt-4">✅ Retrieval Scheduled</h2>
                  <div className="mt-4 bg-white/20 rounded-xl px-4 py-3 inline-block">
                    <p className="text-white text-lg font-bold">
                      {fmtTime(car.scheduled_retrieval_time)}
                    </p>
                  </div>
                  <p className="text-white/90 text-sm mt-3 max-w-xs mx-auto">
                    Your car will be brought to the exit at this time. Stay near the exit 5 minutes before.
                  </p>
                </div>
                <div className="p-6">
                  <button
                    onClick={cancelScheduleRetrieval}
                    className="w-full rounded-2xl py-3 text-sm font-semibold border border-red-200 text-red-500 hover:bg-red-50 transition-all"
                  >
                    Cancel Schedule
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* Screen 1: Two Buttons */}
                <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 p-6 text-center text-white">
                  <div className="w-16 h-16 bg-white/20 rounded-full mx-auto flex items-center justify-center backdrop-blur">
                    <CheckCircle2 className="w-9 h-9 text-white" />
                  </div>
                  <h2 className="font-heading text-xl font-bold mt-4">Your car is safely parked</h2>
                  {car.zone && <p className="text-white/90 text-sm mt-1">Zone {car.zone} · Slot {car.slot}</p>}
                  {car.no_show_count > 0 && (
                    <p className="text-white/90 text-xs mt-2 bg-white/15 rounded-xl px-3 py-2 inline-block">
                      Your car was sent back to parking because you didn't reach the gate in time. Please request it again below.
                    </p>
                  )}
                </div>
                <div className="p-6 flex flex-col gap-3">
                  {car?.can_request_retrieval && (
                    <button
                      onClick={handleRequestRetrieval}
                      disabled={requesting}
                      data-testid="request-car-btn"
                      className="w-full btn-primary-navy rounded-2xl py-4 text-lg font-semibold disabled:opacity-70"
                    >
                      {requesting ? "Requesting…" : "🚗 Retrieve My Car Now"}
                    </button>
                  )}
                  <button
                    onClick={() => setShowSchedulePicker(true)}
                    className="w-full rounded-2xl py-3.5 text-sm font-semibold border-2 border-[#1A3C6E] text-[#1A3C6E] hover:bg-[#1A3C6E] hover:text-white transition-all"
                  >
                    ⏰ Schedule for Later
                  </button>
                  {showSchedulePicker && (
                    <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                          When are you leaving?
                        </p>
                        <button
                          onClick={() => { setShowSchedulePicker(false); setScheduleTime(""); }}
                          className="text-gray-400 hover:text-gray-600 text-lg font-bold"
                        >
                          ✕
                        </button>
                      </div>
                      <input
                        type="datetime-local"
                        value={scheduleTime}
                        onChange={e => setScheduleTime(e.target.value)}
                        min={getMinDateTime()}
                        max={getMaxDateTime()}
                        className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-[#0F2044] focus:outline-none focus:border-[#1A3C6E] bg-white"
                      />
                      <p className="text-xs text-gray-400 mt-2">
                        Your car will be ready when you walk out 🚗
                      </p>
                      <button
                        onClick={scheduleRetrieval}
                        disabled={!scheduleTime || scheduling}
                        className="w-full mt-3 bg-[#1A3C6E] text-white rounded-xl py-3 text-sm font-bold disabled:opacity-50 hover:bg-[#0F2044] transition"
                      >
                        {scheduling ? "Scheduling…" : "Confirm Schedule"}
                      </button>
                    </div>
                  )}
                  <p className="text-center text-xs text-gray-400">
                    Request now or schedule for later
                  </p>
                </div>
              </>
            )}
          </div>
        )}

        {/* Screen 3: RETRIEVAL_REQUESTED or BEING_FETCHED */}
        {(status === "RETRIEVAL_REQUESTED" || status === "BEING_FETCHED") && (
          <div
            className="bg-white rounded-3xl shadow-2xl overflow-hidden fade-in-up"
            data-testid="state-retrieval"
          >
            <div className={`p-6 text-center text-white ${status === "BEING_FETCHED"
                ? "bg-gradient-to-br from-[#1A3C6E] to-[#0F2044]"
                : "bg-gradient-to-br from-amber-500 to-amber-600"
              }`}>
              <div className="w-16 h-16 bg-white/20 rounded-full mx-auto
                flex items-center justify-center backdrop-blur">
                <Car className="w-9 h-9 text-white" />
              </div>
              <h2 className="font-heading text-xl font-bold mt-4">
                {status === "BEING_FETCHED"
                  ? "Your car is on the way 🚗"
                  : "Request received!"}
              </h2>
              {status === "RETRIEVAL_REQUESTED" ? (
                <>
                  <p className="text-white/90 text-sm mt-2">✅ Request received! A driver will accept it shortly.</p>
                  {queuePosition && <p className="text-white/80 text-sm mt-1">Queue position: {queuePosition.position}</p>}
                </>
              ) : (
                <p className="text-white/90 text-sm mt-2">🚗 Your car is being fetched right now!</p>
              )}
            </div>

            <div className="px-6 py-5">
              {status === "BEING_FETCHED" && (queuePosition?.estimated_wait_minutes ?? eta) ? (
                <div className="bg-amber-50 border border-amber-100
                  rounded-2xl p-4 text-center mb-4">
                  <p className="text-xs font-bold text-amber-600
                    uppercase tracking-wider">
                    Estimated Wait Time
                  </p>
                  <p className="text-3xl font-extrabold text-[#0F2044] mt-1">
                    ~{queuePosition?.estimated_wait_minutes ?? eta} min
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Time left before your car arrives
                  </p>
                </div>
              ) : status === "RETRIEVAL_REQUESTED" ? (
                <div className="bg-amber-50 border border-amber-100
                  rounded-2xl p-4 text-center mb-4">
                  <p className="text-lg font-extrabold text-[#0F2044]">
                    ⏳ Waiting for a driver to accept your request
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    We'll show you a time estimate once a driver accepts
                  </p>
                </div>
              ) : null}

              {queuePosition && queuePosition.total_waiting > 1 && (
                <div className="bg-blue-50 border border-blue-100
                  rounded-2xl p-4 text-center mb-4">
                  <p className="text-xs font-bold text-blue-600
                    uppercase tracking-wider">
                    Queue Position
                  </p>
                  {queuePosition.being_fetched ? (
                    <p className="text-2xl font-extrabold
                      text-[#0F2044] mt-1">
                      Your car is being fetched now 🚗
                    </p>
                  ) : (
                    <>
                      <p className="text-3xl font-extrabold
                        text-[#0F2044] mt-1">
                        #{queuePosition.position}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {queuePosition.position === 1
                          ? "You are next in line"
                          : `${queuePosition.position - 1} car${queuePosition.position - 1 > 1 ? "s" : ""
                          } ahead of you`}
                      </p>
                    </>
                  )}
                </div>
              )}

              <div className="relative mt-2">
                <div className="flex justify-between items-center relative z-10">
                  <div className="flex flex-col items-center w-1/3">
                    <div className="w-10 h-10 rounded-full bg-[#1A3C6E]
                      text-white flex items-center justify-center
                      font-bold text-sm">✓</div>
                    <span className="text-xs font-semibold text-[#0F2044]
                      mt-2 text-center">Requested</span>
                  </div>
                  <div className="flex flex-col items-center w-1/3">
                    <div className={`w-10 h-10 rounded-full flex items-center
                      justify-center font-bold text-sm ${status === "BEING_FETCHED"
                        ? "bg-[#1A3C6E] text-white"
                        : "bg-gray-100 text-gray-400"
                      }`}>
                      {status === "BEING_FETCHED" ? "🚗" : "2"}
                    </div>
                    <span className={`text-xs font-semibold mt-2 text-center
                      ${status === "BEING_FETCHED"
                        ? "text-[#0F2044]" : "text-gray-400"}`}>
                      Fetching
                    </span>
                  </div>
                  <div className="flex flex-col items-center w-1/3">
                    <div className="w-10 h-10 rounded-full bg-gray-100
                      text-gray-400 flex items-center justify-center
                      font-bold text-sm">3</div>
                    <span className="text-xs font-semibold text-gray-400
                      mt-2 text-center">Delivered</span>
                  </div>
                </div>
                <div className="absolute top-5 left-[17%] right-[17%]
                  h-1 bg-gray-100 rounded-full">
                  <div className={`h-full bg-[#1A3C6E] rounded-full
                    transition-all duration-700 ${status === "BEING_FETCHED" ? "w-1/2" : "w-0"
                    }`} />
                </div>
              </div>

              <p className="text-center text-xs text-gray-400 mt-5">
                Please make your way to the valet area
              </p>
            </div>
          </div>
        )}

        {/* Screen 3.5: ARRIVED_AT_GATE */}
        {status === "ARRIVED_AT_GATE" && (
          <div className="bg-white rounded-3xl shadow-2xl overflow-hidden fade-in-up" data-testid="state-arrived-gate">
            <div className="p-6 text-center text-white bg-gradient-to-br from-[#1A3C6E] to-[#0F2044]">
              <div className="w-16 h-16 bg-white/20 rounded-full mx-auto flex items-center justify-center backdrop-blur">
                <Car className="w-9 h-9 text-white" />
              </div>
              <h2 className="font-heading text-xl font-bold mt-4">Your car is at the gate 🚗</h2>
              <p className="text-white/90 text-sm mt-2">Please head to the gate now to collect it.</p>
            </div>
            <div className="px-6 py-5">
              {secondsLeft !== null && (
                <div className={`rounded-2xl p-4 text-center mb-4 border ${secondsLeft <= 60 ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-100"}`}>
                  <p className={`text-xs font-bold uppercase tracking-wider ${secondsLeft <= 60 ? "text-red-600" : "text-amber-600"}`}>
                    Time remaining
                  </p>
                  <p className={`text-3xl font-extrabold mt-1 ${secondsLeft <= 60 ? "text-red-600" : "text-[#0F2044]"}`}>
                    {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Your car will be sent back to parking if you don't arrive in time.
                  </p>
                </div>
              )}
              {deliveryOtp && (
                <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 text-center">
                  <p className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Share this code with your driver</p>
                  <p className="text-4xl font-extrabold text-[#0F2044] mt-2 tracking-widest">{deliveryOtp}</p>
                  <p className="text-xs text-gray-400 mt-2">The driver needs this code to hand over your car.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Screen 3.6: AWAITING_REPARK */}
        {status === "AWAITING_REPARK" && (
          <div className="bg-white rounded-3xl shadow-2xl overflow-hidden fade-in-up" data-testid="state-awaiting-repark">
            <div className="p-6 text-center text-white bg-gradient-to-br from-amber-500 to-amber-600">
              <div className="w-16 h-16 bg-white/20 rounded-full mx-auto flex items-center justify-center backdrop-blur">
                <Clock className="w-9 h-9 text-white animate-pulse" />
              </div>
              <h2 className="font-heading text-xl font-bold mt-4">Your car is being re-parked</h2>
              <p className="text-white/90 text-sm mt-2">Our driver is parking your car again. This will just take a moment.</p>
            </div>
            <div className="px-6 py-5 text-center">
              <p className="text-sm text-gray-400 mb-4">Already at the gate? You don't have to wait for it to be re-parked.</p>
              <button
                onClick={handleRequestRetrieval}
                disabled={requesting}
                className="w-full py-3 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-bold disabled:opacity-60 transition-colors"
              >
                {requesting ? "Sending..." : "I'm at the gate — bring my car back"}
              </button>
            </div>
          </div>
        )}

        {/* Screen 4: DELIVERED */}
        {status === "DELIVERED" && (
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center mx-auto">
            <div className="w-20 h-20 bg-emerald-100 rounded-full mx-auto flex items-center justify-center mb-4">
              <span className="text-5xl">✅</span>
            </div>
            <h1 className="font-bold text-2xl text-gray-800 mb-2">Car Delivered!</h1>
            <p className="text-gray-500 text-sm mb-6">
              Your {car.color} {car.make} ({car.plate}) has been delivered. Thank you for using our valet service.
            </p>

            {!rated ? (
              <div className="border-t border-gray-100 pt-6 space-y-6">
                <div>
                  <p className="font-bold text-gray-700 mb-1">Platform Experience</p>
                  <p className="text-gray-400 text-xs mb-3">Rate the InstaPark platform</p>
                  <div className="flex justify-center gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        onClick={() => setPlatformStars(star)}
                        onMouseEnter={() => setHoverPlatform(star)}
                        onMouseLeave={() => setHoverPlatform(0)}
                        className="w-12 h-12 rounded-full bg-gray-50 hover:bg-amber-50 flex items-center justify-center transition-colors border border-gray-200 hover:border-amber-300"
                      >
                        <Star className={`w-6 h-6 ${star <= (hoverPlatform || platformStars) ? "text-amber-400 fill-amber-400" : "text-gray-300"}`} />
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="font-bold text-gray-700 mb-1">Driver Performance</p>
                  <p className="text-gray-400 text-xs mb-3">Rate your valet driver</p>
                  <div className="flex justify-center gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        onClick={() => setDriverStars(star)}
                        onMouseEnter={() => setHoverDriver(star)}
                        onMouseLeave={() => setHoverDriver(0)}
                        className="w-12 h-12 rounded-full bg-gray-50 hover:bg-amber-50 flex items-center justify-center transition-colors border border-gray-200 hover:border-amber-300"
                      >
                        <Star className={`w-6 h-6 ${star <= (hoverDriver || driverStars) ? "text-amber-400 fill-amber-400" : "text-gray-300"}`} />
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <Textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Tell us about your experience (optional)"
                    className="w-full min-h-[100px] p-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all resize-y"
                  />
                </div>

                <button
                  onClick={rate}
                  disabled={!platformStars || !driverStars}
                  className="w-full py-3 rounded-xl bg-blue-600 text-white font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                >
                  Submit Rating
                </button>
              </div>
            ) : (
              <div className="border-t border-gray-100 pt-6">
                <p className="text-emerald-600 font-bold">⭐ Thank you for your rating!</p>
                <p className="text-gray-400 text-xs mt-1">Your feedback helps us improve.</p>
              </div>
            )}
          </div>
        )}

        <div className="text-center text-white/40 text-xs mt-auto pt-6">Powered by InstaPark</div>
      </div>
    </div>
  );
}
