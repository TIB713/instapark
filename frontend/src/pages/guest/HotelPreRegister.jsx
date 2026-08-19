import { useEffect, useState, useRef } from "react"; 
import { useParams } from "react-router-dom"; 
import { api } from "@/lib/api"; 
import { Building, User, Phone, Calendar, MapPin, ChevronDown, Loader2 } from "lucide-react"; 
import { useScrollToFirstError } from "../../hooks/useScrollToFirstError"; 

export default function HotelPreRegister() { 
  const { hotelToken } = useParams(); 
  const [pageData, setPageData] = useState(null); 
  const [loading, setLoading] = useState(true); 
  const [invalid, setInvalid] = useState(false); 
  const [submitting, setSubmitting] = useState(false); 
  const [submitted, setSubmitted] = useState(false); 
  const [passToken, setPassToken] = useState(null);

  const [errors, setErrors] = useState({});

  const [form, setForm] = useState({ 
    event_id: "", 
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
    'event_id', 'guest_name', 'guest_phone', 'plate', 'make', 'color', 'expected_arrival'
  ], fieldRefs);

  const validatePlate = (plate) => { 
    const cleaned = plate.replace(/[-\s]/g, "").toUpperCase(); 
    const standard = /^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{1,4}$/.test(cleaned); 
    const bharat = /^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$/.test(cleaned); 
    return standard || bharat; 
  };

  useEffect(() => { 
    api.get(`/pre-register/hotel/${hotelToken}`) 
      .then(r => { 
        setPageData(r.data); 
        if (r.data.events?.length === 1) { 
          setForm(f => ({ ...f, event_id: r.data.events[0].id })); 
        } 
        setLoading(false); 
      }) 
      .catch(() => { setInvalid(true); setLoading(false); }); 
  }, [hotelToken]); 

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
      const result = await api.post(`/pre-register/hotel/${hotelToken}`, { 
        ...form, 
        plate: form.plate.trim().toUpperCase(), 
        guest_name: form.guest_name.trim(), 
        guest_phone: normalizedPhone || form.guest_phone.trim(), 
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
          <Building className="w-8 h-8 text-red-500" /> 
        </div> 
        <h1 className="font-bold text-xl text-gray-800 mb-2">Invalid Link</h1> 
        <p className="text-gray-500 text-sm">This hotel registration link is not valid. Please contact the hotel front desk.</p> 
      </div> 
    </div> 
  ); 

  if (submitted) return ( 
    <div className="min-h-screen bg-gradient-to-br from-[#1D4ED8] to-[#1E40AF] flex items-center justify-center p-4"> 
      <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center"> 
        <div className="w-20 h-20 bg-emerald-100 rounded-full mx-auto flex items-center justify-center mb-4"> 
          <span className="text-4xl">✅</span> 
        </div> 
        <h1 className="font-bold text-2xl text-gray-800 mb-2">You're Registered for Hotel Valet!</h1> 
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
            className="block w-full bg-[#1D4ED8] text-white rounded-2xl py-4 font-bold 
            text-sm tracking-wider text-center mt-4 hover:bg-[#1E40AF] transition" 
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
            <Building className="w-7 h-7 text-white" /> 
          </div> 
          <h1 className="font-bold text-xl">Hotel Valet Pre-Registration</h1> 
          <p className="text-white/80 text-sm mt-1">{pageData.hotel.name} · {pageData.hotel.city}</p> 
        </div> 

        <div className="p-6 space-y-4"> 
          {/* Event Selection */} 
          <div> 
            {!pageData.events || pageData.events.length === 0 ? ( 
              <>
                <label className={lbl}>Today's Service</label> 
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800"> 
                  Hotel valet service is not active right now. Please try again later or contact the hotel front desk. 
                </div> 
              </>
            ) : pageData.events.length === 1 ? (
              <>
                <label className={lbl}>Today's Valet Service</label> 
                <div className="w-full border border-gray-100 rounded-xl px-4 py-3 text-sm bg-gray-50 font-semibold text-[#0F2044]">
                  {pageData.events[0].name}
                </div>
              </>
            ) : ( 
              <>
                <label className={lbl}>Today's Service *</label> 
                <div className="relative"> 
                  <select 
                    value={form.event_id} 
                    ref={el => { if (fieldRefs && fieldRefs.current) fieldRefs.current.event_id = el; }}
                    onChange={e => { setForm({...form, event_id: e.target.value}); if (errors.event_id) setErrors(prev => ({ ...prev, event_id: undefined })); }} 
                    className={inp + " appearance-none pr-8"} 
                  > 
                    <option value="">-- Select Service --</option> 
                    {pageData.events.map(e => ( 
                      <option key={e.id} value={e.id}> 
                        {e.name}
                      </option> 
                    ))} 
                  </select>
{ errors.event_id && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.event_id}</p> } 
                  <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" /> 
                </div> 
              </>
            )} 
          </div> 

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
              onChange={e => { setForm({...form, expected_arrival: e.target.value}); if (errors.expected_arrival) setErrors(prev => ({ ...prev, expected_arrival: undefined })); }} />
{ errors.expected_arrival && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.expected_arrival}</p> } 
          </div> 

          <div>
            <label className="block text-xs font-bold
              text-gray-500 uppercase tracking-wider mb-1">
              Special Instructions
              <span className="text-gray-400 font-normal
                normal-case ml-1">(optional)</span>
            </label>
            <textarea
              value={form.guest_notes}
              onChange={e => setForm({
                ...form, guest_notes: e.target.value
              })}
              placeholder="e.g. Please don't fold side mirrors, 
              baby seat inside, stiff handbrake..."
              maxLength={200}
              rows={3}
              className="w-full border border-gray-200 rounded-2xl
                px-4 py-3 text-sm text-gray-700 resize-none
                focus:outline-none focus:ring-2
                focus:ring-[#1D4ED8]/20
                placeholder:text-gray-400"
            />
            <p className="text-xs text-gray-400 mt-1 text-right">
              {form.guest_notes.length}/200
            </p>
          </div>

          {/* Submit */} 
          <button onClick={submit} disabled={submitting || pageData.events.length === 0} 
            className="w-full bg-[#1D4ED8] text-white rounded-2xl py-4 font-bold text-sm tracking-wider hover:bg-[#1E40AF] transition disabled:opacity-60 mt-2"> 
            {submitting ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "REGISTER FOR HOTEL VALET →"} 
          </button> 

          <p className="text-center text-xs text-gray-400"> 
            You'll receive a QR code via SMS. Use the same link to request your car when leaving. 
          </p> 
        </div> 
      </div> 
    </div> 
  ); 
} 
