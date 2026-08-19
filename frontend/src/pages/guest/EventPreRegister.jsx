import { useEffect, useState, useRef } from "react"; 
import { useParams } from "react-router-dom"; 
import { api } from "@/lib/api"; 
import { Calendar, Loader2 } from "lucide-react"; 
import { fmtDate } from "@/lib/time";
import { useScrollToFirstError } from "../../hooks/useScrollToFirstError";

export default function EventPreRegister() { 
  const { eventToken } = useParams(); 
  const [pageData, setPageData] = useState(null); 
  const [loading, setLoading] = useState(true); 
  const [invalid, setInvalid] = useState(false); 
  const [closed, setClosed] = useState(false);
  const [submitting, setSubmitting] = useState(false); 
  const [submitted, setSubmitted] = useState(false); 
  const [passToken, setPassToken] = useState(null);

  const [errors, setErrors] = useState({});

  const [form, setForm] = useState({ 
    guest_name: "", 
    guest_phone: "", 
    plate: "", 
    make: "", 
    color: "", 
    expected_arrival: "", 
    guest_notes: "",
  }); 

  const fieldRefs = useRef({});
  const scrollToFirstError = useScrollToFirstError([
    'guest_name', 'guest_phone', 'plate', 'make', 'color', 'expected_arrival'
  ], fieldRefs);
  const validatePlate = (plate) => { 
    const cleaned = plate.replace(/[-\s]/g, "").toUpperCase(); 
    const standard = /^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{1,4}$/.test(cleaned); 
    const bharat = /^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$/.test(cleaned); 
    return standard || bharat; 
  };

  const toLocalInputValue = (date) => {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  };

  const getEventBounds = () => {
    const ev = pageData?.event;
    if (!ev || ev.event_type === "hotel_daily") return null;
    const start = new Date(`${ev.date}T${ev.start_time || "00:00"}:00`);
    const end = new Date(`${ev.end_date || ev.date}T${ev.end_time || "23:59"}:00`);
    return { start, end };
  };

  const getMinDateTime = () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 5);
    const bounds = getEventBounds();
    if (bounds) return toLocalInputValue(now > bounds.start ? now : bounds.start);
    return toLocalInputValue(now);
  };

  const getMaxDateTime = () => {
    const bounds = getEventBounds();
    return bounds ? toLocalInputValue(bounds.end) : undefined;
  };

  useEffect(() => { 
    api.get(`/pre-register/event/${eventToken}`) 
      .then(r => { 
        setPageData(r.data); 
        setLoading(false); 
      }) 
      .catch((err) => { 
        if (err.response?.status === 403) setClosed(true);
        else setInvalid(true);
        setLoading(false); 
      });
  }, [eventToken]); 

    const validate = () => {
    const errs = {};
    if (!form.guest_name.trim()) errs.guest_name = "Please enter your name";
    
    const normalizePhone = (p) => p.replace(/^(\+91|91|0)/, '').replace(/\s|-/g, '');
    const normalizedPhone = normalizePhone(form.guest_phone.trim());
    if (!/^\d{10}$/.test(normalizedPhone) && !/^\+\d{10,15}$/.test(form.guest_phone.trim())) {
      errs.guest_phone = 'Enter a valid 10-digit mobile number';
    }
    
    if (!form.plate.trim()) errs.plate = "Please enter your vehicle plate number";
    else if (!validatePlate(form.plate.trim())) errs.plate = "Please enter a valid Indian number plate (e.g. GJ01AB1234)";
    
    if (!form.make.trim()) errs.make = "Please enter your vehicle make/model";
    if (!form.color.trim()) errs.color = "Please enter your vehicle color";
    
    if (form.expected_arrival) {
      const bounds = getEventBounds();
      if (bounds) {
        const chosen = new Date(form.expected_arrival);
        if (chosen < bounds.start) errs.expected_arrival = `Arrival time cannot be before the event starts (${pageData.event.start_time})`;
        else if (chosen > bounds.end) errs.expected_arrival = `Arrival time cannot be after the event ends (${pageData.event.end_time})`;
      }
    }
    
    return errs;
  };

  const submit = async () => {
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      scrollToFirstError(errs);
      return;
    }
    
    const normalizePhone = (p) => p.replace(/^(\+91|91|0)/, '').replace(/\s|-/g, '');
    const normalizedPhone = normalizePhone(form.guest_phone.trim());
    setForm(f => ({ ...f, guest_phone: normalizedPhone || form.guest_phone.trim() }));

    setSubmitting(true);
    try { 
      const expectedArrivalUTC = form.expected_arrival 
        ? new Date(form.expected_arrival).toISOString() 
        : ""; 
      const result = await api.post(`/pre-register/event/${eventToken}`, { 
        ...form, 
        plate: form.plate.trim().toUpperCase(), 
        guest_name: form.guest_name.trim(), 
        guest_phone: form.guest_phone.trim(), 
        guest_notes: form.guest_notes.trim() || null,
        expected_arrival: expectedArrivalUTC,
      }); 
      setPassToken(result.data.pass_token);
      setSubmitted(true); 
    } catch (err) { 
      alert(err.response?.data?.detail || "Registration failed. Please try again."); 
    } finally { setSubmitting(false); } 
  }; 

  if (loading) return ( 
    <div className="min-h-screen bg-gradient-to-br from-[#1D4ED8] to-[#1E40AF] flex items-center justify-center"> 
      <Loader2 className="w-10 h-10 text-white animate-spin" /> 
    </div> 
  ); 

  if (invalid) return ( 
    <div className="min-h-screen bg-gradient-to-br from-[#1D4ED8] to-[#1E40AF] flex items-center justify-center p-4"> 
      <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center"> 
        <div className="w-16 h-16 bg-red-100 rounded-full mx-auto flex items-center justify-center mb-4"> 
          <Calendar className="w-8 h-8 text-red-500" /> 
        </div> 
        <h1 className="font-bold text-xl text-gray-800 mb-2">Invalid Link</h1> 
        <p className="text-gray-500 text-sm">This event registration link is not valid.</p> 
      </div> 
    </div> 
  ); 

  if (closed) return ( 
    <div className="min-h-screen bg-gradient-to-br from-[#1D4ED8] to-[#1E40AF] flex items-center justify-center p-4"> 
      <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center"> 
        <div className="w-16 h-16 bg-orange-100 rounded-full mx-auto flex items-center justify-center mb-4"> 
          <Calendar className="w-8 h-8 text-orange-500" /> 
        </div> 
        <h1 className="font-bold text-xl text-gray-800 mb-2">Event Closed</h1> 
        <p className="text-gray-500 text-sm">This event is closed and no longer accepting registrations.</p> 
      </div> 
    </div> 
  ); 

  if (submitted) return ( 
    <div className="min-h-screen bg-gradient-to-br from-[#1D4ED8] to-[#1E40AF] flex items-center justify-center p-4"> 
      <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center"> 
        <div className="w-20 h-20 bg-emerald-100 rounded-full mx-auto flex items-center justify-center mb-4"> 
          <span className="text-4xl">✅</span> 
        </div> 
        <h1 className="font-bold text-2xl text-gray-800 mb-2">You're Registered!</h1> 
        <p className="text-gray-500 text-sm mb-4"> 
          A QR code has been sent to your mobile number. Show it to the valet at the gate for fast check-in. 
        </p> 
        <div className="bg-blue-50 rounded-2xl p-4 text-left"> 
          <p className="text-xs font-bold text-blue-700 uppercase tracking-wider mb-2">On Arrival</p> 
          <p className="text-sm text-blue-800">📱 Click the button below to open your QR code</p> 
          <p className="text-sm text-blue-800 mt-2">📸 Please wait while they photograph your vehicle — under 30 seconds</p> 
          <p className="text-sm text-blue-800 mt-2">🚗 Use the same link to request your car when you're ready to leave</p> 
        </div> 

        {passToken && ( 
          <a 
            href={`/pass/${passToken}`} 
            className="block w-full bg-[#1D4ED8] text-white rounded-2xl py-4 font-bold text-sm tracking-wider text-center mt-4 hover:bg-[#1E40AF] transition" 
          > 
            VIEW MY QR CODE → 
          </a> 
        )} 
      </div> 
    </div> 
  ); 

  const inp = "w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#1D4ED8] bg-white"; 
  const lbl = "block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5"; 

  return ( 
    <div className="min-h-screen bg-gradient-to-br from-[#1D4ED8] to-[#1E40AF] flex items-center justify-center p-4"> 
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"> 
        {/* Header */} 
        <div className="bg-gradient-to-r from-[#1D4ED8] to-[#1E40AF] p-6 text-white text-center"> 
          <div className="w-14 h-14 bg-white/20 rounded-2xl mx-auto flex items-center justify-center mb-3"> 
            <Calendar className="w-7 h-7 text-white" /> 
          </div> 
          <h1 className="font-bold text-xl">{pageData.event.name}</h1> 
          <p className="text-white/80 text-sm mt-1">{pageData.event.venue} · {fmtDate(pageData.event.date)}</p> 
        </div> 

        <div className="p-6 space-y-4"> 
          {/* Guest Name */} 
          <div> 
            <label className={lbl}>Your Name *</label> 
            <input className={inp} placeholder="Rahul Shah" 
              ref={el => { if (fieldRefs && fieldRefs.current) fieldRefs.current.guest_name = el; }}
              value={form.guest_name} onChange={e => { setForm({...form, guest_name: e.target.value}); if (errors.guest_name) setErrors(prev => ({ ...prev, guest_name: undefined })); }} />
{ errors.guest_name && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.guest_name}</p> } 
          </div> 

          {/* Phone */} 
          <div> 
            <label className={lbl}>Mobile Number * <span className="text-gray-400 font-normal normal-case">(QR will be sent here)</span></label> 
            <input className={inp} placeholder="10-digit number" 
              type="tel" value={form.guest_phone} 
              ref={el => { if (fieldRefs && fieldRefs.current) fieldRefs.current.guest_phone = el; }}
              onChange={e => { setForm({...form, guest_phone: e.target.value.replace(/\D/g, "").slice(0, 10)}); if (errors.guest_phone) setErrors(prev => ({ ...prev, guest_phone: undefined })); }} />
{ errors.guest_phone && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.guest_phone}</p> } 
          </div> 

          {/* Divider */} 
          <div className="border-t border-gray-100 pt-2"> 
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Vehicle Details</p> 
          </div>

          {/* Plate */} 
          <div> 
            <label className={lbl}>Number Plate *</label> 
            <input className={inp + " font-mono tracking-widest uppercase"} placeholder="GJ01AB1234" 
              value={form.plate} 
              ref={el => { if (fieldRefs && fieldRefs.current) fieldRefs.current.plate = el; }}
              onChange={e => { setForm({...form, plate: e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 11)}); if (errors.plate) setErrors(prev => ({ ...prev, plate: undefined })); }} />
{ errors.plate && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.plate}</p> } 
          </div> 

          {/* Make */} 
          <div> 
            <label className={lbl}>Make / Model *</label> 
            <input className={inp} placeholder="Honda City" 
              value={form.make} 
              ref={el => { if (fieldRefs && fieldRefs.current) fieldRefs.current.make = el; }}
              onChange={e => { setForm({...form, make: e.target.value}); if (errors.make) setErrors(prev => ({ ...prev, make: undefined })); }} />
{ errors.make && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.make}</p> } 
          </div> 

          {/* Color */} 
          <div> 
            <label className={lbl}>Color *</label> 
            <input className={inp} placeholder="White" 
              value={form.color} 
              ref={el => { if (fieldRefs && fieldRefs.current) fieldRefs.current.color = el; }}
              onChange={e => { setForm({...form, color: e.target.value}); if (errors.color) setErrors(prev => ({ ...prev, color: undefined })); }} />
{ errors.color && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.color}</p> } 
          </div> 

          {/* Expected Arrival */} 
          <div> 
            <label className={lbl}>Expected Arrival Time <span className="text-gray-400 font-normal normal-case">(optional)</span></label> 
            <input type="datetime-local" className={inp} 
              value={form.expected_arrival} 
              ref={el => { if (fieldRefs && fieldRefs.current) fieldRefs.current.expected_arrival = el; }}
              min={getMinDateTime()}
              max={getMaxDateTime()}
              onChange={e => { setForm({...form, expected_arrival: e.target.value}); if (errors.expected_arrival) setErrors(prev => ({ ...prev, expected_arrival: undefined })); }} />
{ errors.expected_arrival && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.expected_arrival}</p> } 
          </div> 

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
              Special Instructions
              <span className="text-gray-400 font-normal normal-case ml-1">(optional)</span>
            </label>
            <textarea
              value={form.guest_notes}
              onChange={e => setForm({...form, guest_notes: e.target.value})}
              placeholder="e.g. Please don't fold side mirrors, baby seat inside, stiff handbrake..."
              maxLength={200}
              rows={3}
              className="w-full border border-gray-200 rounded-2xl px-4 py-3 text-sm text-gray-700 resize-none focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 placeholder:text-gray-400"
            />
            <p className="text-xs text-gray-400 mt-1 text-right">
              {form.guest_notes.length}/200
            </p>
          </div>

          {/* Submit */} 
          <button onClick={submit} disabled={submitting} 
            className="w-full bg-[#1D4ED8] text-white rounded-2xl py-4 font-bold text-sm tracking-wider hover:bg-[#1E40AF] transition disabled:opacity-60 mt-2"> 
            {submitting ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "REGISTER FOR VALET →"} 
          </button> 

          <p className="text-center text-xs text-gray-400"> 
            You'll receive a QR code via SMS. Use the same link to request your car when leaving. 
          </p> 
        </div> 
      </div> 
    </div> 
  ); 
}
