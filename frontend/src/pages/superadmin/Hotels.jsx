import { useEffect, useMemo, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import SuperLayout from "@/components/layout/SuperLayout";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/time";
import { toast } from "sonner";
import { Plus, Search, Building2, Camera, X, Hotel, Check, AlertTriangle, CheckCircle } from "lucide-react";
import { State, City } from "country-state-city";
import SkeletonTable from "@/components/ui/SkeletonTable";
import EmptyState from "@/components/ui/EmptyState";

import { useScrollToFirstError } from "../../hooks/useScrollToFirstError";

const generateTempPassword = () => Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10).toUpperCase() + "1!";

export default function Hotels() {
  const fieldRefs = useRef({});

  const scrollToFirstError = useScrollToFirstError(["name", "email", "phone", "contact_person_phone", "password", "address", "city", "state", "total_valet_slots", "contact_person_name", "plan", "gate_timer_minutes"], fieldRefs);
  const [rows, setRows] = useState([]);
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchRef = useRef(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const nav = useNavigate();

  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState(null);
  const [errors, setErrors] = useState({});
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [zones, setZones] = useState([{ name: "A", slots: "" }]);
  const [gates, setGates] = useState(["Main Gate"]);

  const [hotelPhotoPreview, setHotelPhotoPreview] = useState(null);
  const [form, setForm] = useState({
    name: "", email: "", phone: "", password: "", plan: "starter",
    address: "", city: "", state: "", logo_url: "",
    total_valet_slots: "", contact_person_name: "", contact_person_phone: "", gate_timer_minutes: "5", allow_instant_park: false
  });

  const totalSlots = useMemo(() => zones.reduce((sum, z) => sum + (parseInt(z.slots) || 0), 0), [zones]);

  const handlePhotoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setHotelPhotoPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "hotels");
      const { data } = await api.post("/upload", fd);
      setForm(prev => ({ ...prev, hotel_photo: data.url }));
      toast.success("Photo uploaded");
    } catch {
      toast.error("Photo upload failed");
    } finally {
      setUploading(false);
    }
  };

  const validate = () => {
    const errs = {};
    if (!form.name?.trim()) errs.name = "Name is required";
    if (!form.email?.trim()) errs.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errs.email = "Please enter a valid email address";
    if (!form.phone?.trim()) errs.phone = "Phone is required";
    else if (!/^\d{10}$/.test(form.phone)) errs.phone = "Phone must be exactly 10 digits";
    if (!form.contact_person_phone?.trim()) errs.contact_person_phone = "Contact person phone is required";
    else if (!/^\d{10}$/.test(form.contact_person_phone)) errs.contact_person_phone = "Contact person phone must be exactly 10 digits";
    // if (!form.password?.trim()) errs.password = "Password is required";
    // else if (form.password.length < 8) errs.password = "Password must be at least 8 characters";
    if (!form.address?.trim()) errs.address = "Address is required";
    if (!form.city?.trim()) errs.city = "City is required";
    if (!form.state?.trim()) errs.state = "State is required";
    if (!form.total_valet_slots || parseInt(form.total_valet_slots) < 1) errs.total_valet_slots = "Total valet slots must be at least 1";
    if (!form.contact_person_name?.trim()) errs.contact_person_name = "Contact person name is required";
    return errs;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      scrollToFirstError(errs);
      return;
    }
    setSaving(true);
    try {
      const { data: newProvider } = await api.post("/providers", {
        name: form.name, email: form.email, phone: form.phone,
        plan: form.plan, password: generateTempPassword(),
        address: form.address, city: form.city, state: form.state,
        provider_type: "hotel_owner"
      });
      try {
        await api.post("/hotels", {
          name: form.name, address: form.address, city: form.city, state: form.state,
          contact_person_name: form.contact_person_name,
          contact_person_phone: form.contact_person_phone,
          contact_person_email: form.email,
          total_valet_slots: parseInt(form.total_valet_slots),
          gate_timer_minutes: form.gate_timer_minutes ? parseInt(form.gate_timer_minutes) : 5,
          allow_instant_park: !!form.allow_instant_park,
          hotel_photo: form.logo_url || null,
          provider_id: newProvider.id,
          zones: zones.map(z => ({ name: z.name.trim(), slots: parseInt(z.slots) || 0 })).filter(z => z.name),
          gates: gates.filter(g => g.trim())
        });
      } catch (hotelErr) {
        const detail = hotelErr.response?.data?.detail;
        let hotelMessage = "Hotel setup failed";
        if (typeof detail === "string") {
          hotelMessage = detail;
        } else if (Array.isArray(detail) && detail.length > 0) {
          hotelMessage = detail.map(d => d.msg || JSON.stringify(d)).join(", ");
        }
        toast.warning(`Provider created but hotel setup failed: ${hotelMessage}`);
        console.error("Hotel setup failed for new provider", newProvider.id, hotelErr);
      }
      setCreated(newProvider);
      setForm({ name: "", email: "", phone: "", password: "", plan: "starter", address: "", city: "", state: "", logo_url: "", total_valet_slots: "", contact_person_name: "", contact_person_phone: "", gate_timer_minutes: "5", allow_instant_park: false });
      setZones([{ name: "A", slots: "" }]);
      setGates(["Main Gate"]);
      setHotelPhotoPreview(null);
      toast.success("Hotel provider created!");
    } catch (err) {
      console.error("Hotel provider creation failed", err);
      toast.error(err.response?.data?.detail || "Failed to create hotel provider");
    } finally {
      setSaving(false);
    }
    // Reload the list separately — creation has already succeeded by this
    // point (the success modal above already reflects that), so a failure
    // here must never be reported as a creation failure. It's a silent
    // best-effort refresh; if it fails, the new provider still shows up on
    // the next natural reload (navigating away and back, or the periodic
    // reload if one exists).
    try {
      const resHotels = await api.get("/hotels");
      setRows(resHotels.data.filter(h => h.provider_type === "hotel_owner"));
    } catch (reloadErr) {
      console.error("Failed to refresh hotel list after creation", reloadErr);
    }
  };

  useEffect(() => {
    Promise.all([
      api.get("/hotels"),
      api.get("/providers")
    ])
      .then(([resHotels, resProviders]) => {
        // Only show hotels belonging to hotel_owner providers
        setRows(resHotels.data.filter(h => h.provider_type === "hotel_owner"));
        setProviders(resProviders.data.filter(p => p.provider_type === "hotel_owner"));
      })
      .catch(() => toast.error("Failed to load hotels"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleEsc = (e) => {
      if (e.key === "Escape") { setOpen(false); setErrors({}); }
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open]);

  const suggestions = useMemo(() => {
    if (!q || q.length < 1) return [];
    return rows
      .filter(r => r.name?.toLowerCase().includes(q.toLowerCase()) || r.provider_name?.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 5);
  }, [rows, q]);

  const filtered = useMemo(() => rows.filter(r => { 
    const matchQ = !q || `${r.name} ${r.provider_name}`.toLowerCase().includes(q.toLowerCase()); 
    const effectiveActive = !!(r.is_active && r.provider_is_verified);
    const matchStatus = statusFilter === "all" || (statusFilter === "active" ? effectiveActive : !effectiveActive); 
    return matchQ && matchStatus; 
  }), [rows, q, statusFilter]);

  return (
    <SuperLayout title="Hotels">
      <div className="flex flex-wrap items-center gap-3 justify-between mb-6">
        <div>
          <h1 className="font-heading text-2xl font-bold text-[#0F2044]">Hotel Providers</h1>
          <p className="text-gray-500 text-sm">Hotels registered directly on InstaPark.</p>
        </div>
        <button onClick={() => { setOpen(true); setCreated(null); setErrors({}); }}
          className="flex items-center gap-2 bg-[#1D4ED8] text-white rounded-xl px-4 py-2.5 font-medium text-sm hover:bg-[#1e40af] transition shadow-sm">
          <Plus className="w-4 h-4" /> Add Hotel Provider
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-4 mb-5 flex flex-wrap gap-4 items-end">
        <div className="flex-1 min-w-[250px]">
          <label className="text-[10px] uppercase font-bold text-gray-400 mb-1.5 block ml-1">Search</label>
          <div className="relative flex-1 min-w-[200px]" ref={searchRef}>
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={q} 
                   onChange={(e) => { setQ(e.target.value); setShowSuggestions(true); }}
                   onFocus={() => setShowSuggestions(true)}
                   onKeyDown={(e) => { if (e.key === "Escape") setShowSuggestions(false); }}
                   placeholder="Search by hotel or provider name"
                   className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 outline-none focus:border-[#1D4ED8] transition-colors" />
            
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden">
                {suggestions.map(s => (
                  <div key={s.id} onClick={() => { setQ(s.name); setShowSuggestions(false); }}
                       className="px-[14px] py-[10px] hover:bg-[#F9FAFB] cursor-pointer transition-colors border-b border-gray-50 last:border-0">
                    <div className="text-[#0F2044] font-bold text-sm">{s.name}</div>
                    <div className="text-[#9CA3AF] text-xs">{s.provider_name}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          {["all", "active", "inactive"].map(f => (
            <button key={f} onClick={() => setStatusFilter(f)} 
              className={`px-4 py-2 rounded-xl text-sm capitalize font-medium transition-all ${statusFilter === f ? "bg-[#1D4ED8] text-white shadow-lg shadow-[#1D4ED8]/20" : "bg-white border border-gray-200 hover:bg-gray-50"}`}> 
              {f} 
            </button> 
          ))} 
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl shadow-card border border-gray-100 p-5 animate-pulse">
              <div className="flex items-start justify-between">
                <div className="w-11 h-11 rounded-full bg-gray-200" />
                <div className="w-16 h-5 rounded-full bg-gray-200" />
              </div>
              <div className="h-5 w-40 rounded bg-gray-200 mt-4" />
              <div className="h-4 w-52 rounded bg-gray-200 mt-3" />
              <div className="h-4 w-36 rounded bg-gray-200 mt-2" />
              <div className="flex items-center justify-between mt-8">
                <div className="h-3 w-24 rounded bg-gray-200" />
                <div className="h-4 w-14 rounded bg-gray-200" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Hotel className="w-8 h-8 text-[#1D4ED8]" />}
          title={q ? "No hotels found" : "No hotels yet"}
          subtitle={
            q
              ? "Try adjusting your filters to find what you're looking for."
              : "Hotels registered as hotel owners will appear here."
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(h => (
            <div key={h.id} onClick={() => nav(`/superadmin/hotels/${h.id}`)}
              className="bg-white rounded-2xl shadow-card border border-gray-100 p-4 cursor-pointer hover:shadow-md transition-all">
              {/* Top row */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#1D4ED8] flex items-center justify-center shrink-0">
                  {h.hotel_photo ? (
                    <img src={h.hotel_photo} className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <span className="text-white font-bold text-sm">{h.name?.slice(0,2).toUpperCase()}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-[#0F2044] text-sm truncate">{h.name}</span>
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold ${(h.provider_is_verified && h.is_active) ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                      {(h.provider_is_verified && h.is_active) ? "Active" : "Inactive"}
                    </span>
                    {
  h.provider_is_verified ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium shrink-0">
      <CheckCircle className="w-3 h-3" /> Verified
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium shrink-0">
      <AlertTriangle className="w-3 h-3" /> Unverified
    </span>
  )
}
                  </div>
                  <span className="text-gray-400 text-xs truncate block">{h.city}, {h.state}</span>
                </div>
              </div>
              {/* Bottom row */}
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-50">
                <span className="text-gray-500 text-xs">{h.operating_hours_start} - {h.operating_hours_end}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">{h.total_valet_slots} slots</span>
                  <span className="text-gray-400 text-xs">{fmtDate(h.created_at)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {open && createPortal(
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center overflow-y-auto py-8" onClick={() => { setOpen(false); setErrors({}); }}>
          <div
            className="relative bg-white rounded-2xl shadow-2xl max-w-xl w-full p-6 mx-4 fade-in-up"
            onClick={(e) => e.stopPropagation()}
          >
            {created ? (
              <>
                <h3 className="font-heading text-xl font-bold text-[#0F2044]">Hotel Provider Created</h3>
                <p className="text-sm text-gray-500 mt-1">Share these credentials securely.</p>
                <div className="mt-5 space-y-2 text-sm bg-gray-50 rounded-xl p-4 font-mono">
                  <div><span className="text-gray-500">Name:</span> {created.name}</div>
                  <div><span className="text-gray-500">Email:</span> {created.email}</div>
                  {/* <div><span className="text-gray-500">Password:</span> {created.password}</div> */}
                </div>
                <button onClick={() => { setOpen(false); setErrors({}); }}
                        className="mt-5 w-full bg-[#1D4ED8] hover:bg-[#1e40af] text-white rounded-xl py-2.5 font-medium transition-colors">Done</button>
              </>
            ) : (
              <form onSubmit={submit}>
                <div className="flex items-center justify-between mb-6">
                  <h3 className="font-heading text-xl font-bold text-[#0F2044]">Add Hotel Provider</h3>
                  <button type="button" onClick={() => { setOpen(false); setErrors({}); }} className="text-gray-400 hover:text-gray-600">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      ["Name", "name", "text"],
                      ["Email", "email", "email"],
                      ["Phone", "phone", "tel"],
                      // ["Password (min 8)", "password", "text"],
                    ].map(([l, k, t]) => (
                      <div key={k}>
                        <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">{l} <span className="text-red-500">*</span></label>
                        <input ref={el => { if (fieldRefs.current) fieldRefs.current[k] = el; }}  type={t} value={form[k]}
                               onChange={(e) => {
                                 let val = e.target.value;
                                 if (k === "phone") val = val.replace(/\D/g, "").slice(0, 10);
                                 setForm({ ...form, [k]: val });
                                 if (errors[k]) setErrors(prev => ({ ...prev, [k]: undefined }));
                               }}
                               maxLength={k === "phone" ? 10 : undefined}
                               inputMode={k === "phone" ? "numeric" : undefined}
                               className={`mt-1 w-full px-3 py-2 rounded-xl border ${errors[k] ? "border-red-400" : "border-gray-200"} outline-none focus:border-[#1D4ED8] transition-colors`} />
                        {errors[k] && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors[k]}</p>}
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Address <span className="text-red-500">*</span></label>
                      <input ref={el => { if (fieldRefs.current) fieldRefs.current.address = el; }}  type="text" value={form.address}
                        onChange={e => { setForm(prev => ({ ...prev, address: e.target.value})); if (errors.address) setErrors(prev => ({ ...prev, address: undefined })); }}
                        className={`mt-1 w-full px-3 py-2 rounded-xl border ${errors.address ? "border-red-400" : "border-gray-200"} outline-none focus:border-[#1D4ED8] transition-colors`} />
{ errors.address && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.address}</p> }
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">State <span className="text-red-500">*</span></label>
                      <select ref={el => { if (fieldRefs.current) fieldRefs.current.state = el; }} 
                        value={form.state || ""}
                        onChange={e => { setForm(prev => ({ ...prev, state: e.target.value, city: "" })); if (errors.state) setErrors(prev => ({ ...prev, state: undefined })); }}
                        className={`mt-1 w-full px-3 py-2 rounded-xl border ${errors.state ? "border-red-400" : "border-gray-200"} outline-none focus:border-[#1D4ED8] transition-colors`}
                      >
                        <option value="">Select State</option>
                        {State.getStatesOfCountry("IN").map(s => (
                          <option key={s.isoCode} value={s.name}>{s.name}</option>
                        ))}
                      </select>
                      {errors.state && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.state}</p>}
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">City <span className="text-red-500">*</span></label>
                      <select ref={el => { if (fieldRefs.current) fieldRefs.current.city = el; }} 
                        value={form.city || ""}
                        onChange={e => { setForm(prev => ({ ...prev, city: e.target.value })); if (errors.city) setErrors(prev => ({ ...prev, city: undefined })); }}
                        disabled={!form.state}
                        className={`mt-1 w-full px-3 py-2 rounded-xl border ${errors.city ? "border-red-400" : "border-gray-200"} outline-none focus:border-[#1D4ED8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        <option value="">Select City</option>
                        {(form.state
                          ? City.getCitiesOfState("IN", State.getStatesOfCountry("IN").find(s => s.name === form.state)?.isoCode || "")
                          : []
                        ).map(c => (
                          <option key={c.name} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                      {errors.city && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.city}</p>}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 py-2">
                    <div className="flex-1">
                      <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Plan</label>
                      <select ref={el => { if (fieldRefs.current) fieldRefs.current.plan = el; }}  value={form.plan} onChange={(e) => { setForm({ ...form, plan: e.target.value}); if (errors.plan) setErrors(prev => ({ ...prev, plan: undefined })); }}
                              className={`mt-1 w-full px-3 py-2 rounded-xl border ${errors.plan ? "border-red-400" : "border-gray-200"} outline-none focus:border-[#1D4ED8]`}>
                        <option value="starter">Starter</option>
                        <option value="pro">Pro</option>
                      </select>
{ errors.plan && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.plan}</p> }
                    </div>
                    <div className="shrink-0 pt-5">
                      <div className="relative group inline-block">
                        <label className="cursor-pointer flex items-center gap-2 bg-gray-50 px-4 py-2 rounded-xl border border-dashed border-gray-300 hover:border-[#1D4ED8] transition-colors">
                          {form.logo_url || hotelPhotoPreview ? (
                            <img src={form.logo_url || hotelPhotoPreview} className="w-6 h-6 rounded-md object-cover" />
                          ) : (
                            <Camera className="w-5 h-5 text-gray-400" />
                          )}
                          <span className="text-xs font-medium text-gray-600">{form.logo_url || hotelPhotoPreview ? "Change Logo" : "Upload Logo"}</span>
                          <input type="file" className="hidden" accept="image/*" onChange={handlePhotoUpload} disabled={uploading} />
                        </label>
                        {hotelPhotoPreview && (
                          <button
                            type="button"
                            onClick={(e) => { 
                              e.preventDefault(); 
                              e.stopPropagation(); 
                              setHotelPhotoPreview(null); 
                              setForm(prev => ({ ...prev, hotel_photo: null, logo_url: "" })); 
                            }}
                            className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-400 hover:text-red-500 hover:border-red-200 transition-all z-10"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-gray-100 space-y-4">
                    <h4 className="text-xs font-bold text-[#1D4ED8] uppercase tracking-widest">Hotel Details</h4>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="text-xs font-semibold text-gray-600 uppercase">Valet Slots <span className="text-red-500">*</span></label>
                        <input ref={el => { if (fieldRefs.current) fieldRefs.current.total_valet_slots = el; }}  type="number" value={form.total_valet_slots}
                               onChange={(e) => { setForm({ ...form, total_valet_slots: e.target.value}); if (errors.total_valet_slots) setErrors(prev => ({ ...prev, total_valet_slots: undefined })); }}
                               className={`mt-1 w-full px-3 py-2 rounded-xl border ${errors.total_valet_slots ? "border-red-400" : "border-gray-200"} outline-none focus:border-[#1D4ED8]`} />
{ errors.total_valet_slots && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.total_valet_slots}</p> }
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-gray-600 uppercase">Gate Timer (min)</label>
                        <input ref={el => { if (fieldRefs.current) fieldRefs.current.gate_timer_minutes = el; }}  type="number" min="1" max="30" value={form.gate_timer_minutes}
                               onChange={(e) => { setForm({ ...form, gate_timer_minutes: e.target.value}); if (errors.gate_timer_minutes) setErrors(prev => ({ ...prev, gate_timer_minutes: undefined })); }}
                               className={`mt-1 w-full px-3 py-2 rounded-xl border ${errors.gate_timer_minutes ? "border-red-400" : "border-gray-200"} outline-none focus:border-[#1D4ED8]`} />
{ errors.gate_timer_minutes && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.gate_timer_minutes}</p> }
                      </div>
                      <div className="flex items-center gap-2 mt-4">
                        <input type="checkbox" id="allow_instant_park" checked={form.allow_instant_park}
                               onChange={(e) => setForm({ ...form, allow_instant_park: e.target.checked })}
                               className="w-4 h-4 text-[#1D4ED8] bg-gray-100 border-gray-300 rounded focus:ring-[#1D4ED8]" />
                        <label htmlFor="allow_instant_park" className="text-xs font-semibold text-gray-600 uppercase cursor-pointer">
                          Allow Instant Park for this hotel's daily events
                        </label>
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-gray-600 uppercase">Contact Name <span className="text-red-500">*</span></label>
                        <input ref={el => { if (fieldRefs.current) fieldRefs.current.contact_person_name = el; }}  type="text" value={form.contact_person_name}
                               onChange={(e) => { setForm({ ...form, contact_person_name: e.target.value}); if (errors.contact_person_name) setErrors(prev => ({ ...prev, contact_person_name: undefined })); }}
                               className={`mt-1 w-full px-3 py-2 rounded-xl border ${errors.contact_person_name ? "border-red-400" : "border-gray-200"} outline-none focus:border-[#1D4ED8]`} />
{ errors.contact_person_name && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.contact_person_name}</p> }
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-gray-600 uppercase">Contact Phone <span className="text-red-500">*</span></label>
                        <input ref={el => { if (fieldRefs.current) fieldRefs.current.contact_person_phone = el; }}  type="tel" value={form.contact_person_phone} inputMode="numeric"
                               onChange={(e) => { setForm({ ...form, contact_person_phone: e.target.value.replace(/\D/g, "").slice(0, 10)}); if (errors.contact_person_phone) setErrors(prev => ({ ...prev, contact_person_phone: undefined })); }}
                               className={`mt-1 w-full px-3 py-2 rounded-xl border ${errors.contact_person_phone ? "border-red-400" : "border-gray-200"} outline-none focus:border-[#1D4ED8]`} />
{ errors.contact_person_phone && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.contact_person_phone}</p> }
                      </div>
                    </div>

                {/* Gates */}
                <div>
                  <div className="flex items-center justify-between mb-1"> 
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
                          className="flex-1 px-3 py-2 rounded-xl border border-gray-200 outline-none focus:border-[#1D4ED8] text-sm" 
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
                    className="w-full py-2 rounded-xl border border-dashed border-[#1D4ED8] text-[#1D4ED8] text-sm font-semibold hover:bg-blue-50 transition"> 
                    + Add Gate 
                  </button> 
                </div>

                {/* Zones */}
                <div> 
                  <div className="flex items-center justify-between mb-2"> 
                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Parking Zones</label> 
                    <span className={`text-xs font-bold ${totalSlots > form.total_valet_slots ? "text-red-500" : "text-emerald-600"}`}> 
                      {totalSlots} / {form.total_valet_slots || "—"} slots 
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
                          className="flex-1 px-3 py-2 rounded-xl border border-gray-200 outline-none focus:border-[#1D4ED8] text-sm" 
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
                          className="w-20 px-3 py-2 rounded-xl border border-gray-200 outline-none focus:border-[#1D4ED8] text-sm text-center" 
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
                    className="w-full py-2 rounded-xl border border-dashed border-[#1D4ED8] text-[#1D4ED8] text-sm font-semibold hover:bg-blue-50 transition"> 
                    + Add Zone 
                  </button> 
                </div>



                  </div>
                </div>

                
<p className="text-xs text-gray-400 mb-2"><span className="text-red-500">*</span> Required fields</p>
                  <div className="mt-8 flex flex-wrap gap-3">
                  <button type="button" onClick={() => { setOpen(false); setErrors({}); }} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 font-medium transition-colors">Cancel</button>
                  <button type="submit" disabled={uploading || saving}
                          className="flex-1 bg-[#1D4ED8] hover:bg-[#1e40af] text-white rounded-xl py-2.5 font-medium shadow-lg shadow-[#1D4ED8]/20 transition-colors">
                    {uploading ? "Uploading..." : saving ? "Creating..." : "Create Account"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>,
        document.body
      )}
    </SuperLayout>
  );
}
