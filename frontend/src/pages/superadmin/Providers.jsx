import { useEffect, useMemo, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import SuperLayout from "@/components/layout/SuperLayout";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/time";
import { toast } from "sonner";
import { Plus, Search, Building2, X, Check, AlertTriangle, CheckCircle } from "lucide-react";
import EmptyState from "@/components/ui/EmptyState";
import { State, City } from "country-state-city";

import { useScrollToFirstError } from "../../hooks/useScrollToFirstError";

const generateTempPassword = () => Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10).toUpperCase() + "1!";

export default function Providers() {
  const nav = useNavigate();
  const fieldRefs = useRef({});

  const scrollToFirstError = useScrollToFirstError(["name", "email", "phone", "password", "address", "city", "state", "max_events", "max_hotels", "max_cars"], fieldRefs);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState(null);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    plan: "starter",
    password: "",
    provider_type: "valet_provider",
    address: "",
    city: "",
    state: "",
    max_events: 0,
    max_hotels: 0,
    max_cars: 0,
  });

  const load = async () => {
    try { 
      const { data } = await api.get("/providers"); 
      setRows(data.filter(r => r.provider_type === "valet_provider")); 
    }
    catch { toast.error("Failed to load providers"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

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
      .filter(r => r.name?.toLowerCase().includes(q.toLowerCase()) || r.email?.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 5);
  }, [rows, q]);

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (filter === "active" && !r.is_active) return false;
      if (filter === "inactive" && r.is_active) return false;
      if (q && !`${r.name} ${r.email}`.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [rows, filter, q]);

  const validate = () => {
    const errs = {};
    if (!form.name?.trim()) errs.name = "Name is required";
    if (!form.email?.trim()) errs.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errs.email = "Please enter a valid email address";
    if (!form.phone?.trim()) errs.phone = "Phone is required";
    else if (!/^\d{10}$/.test(form.phone)) errs.phone = "Phone must be exactly 10 digits";
    // if (!form.password?.trim()) errs.password = "Password is required";
    // else if (form.password.length < 8) errs.password = "Password must be at least 8 characters";
    if (!form.address?.trim()) errs.address = "Address is required";
    if (!form.city?.trim()) errs.city = "City is required";
    if (!form.state?.trim()) errs.state = "State is required";
    if (form.max_events !== "" && parseInt(form.max_events) < 0) errs.max_events = "Cannot be negative";
    if (form.max_hotels !== "" && parseInt(form.max_hotels) < 0) errs.max_hotels = "Cannot be negative";
    if (form.max_cars !== "" && parseInt(form.max_cars) < 0) errs.max_cars = "Cannot be negative";
    return errs;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (submitting) return; // block if already submitting
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      scrollToFirstError(errs);
      return;
    }
    
    setSubmitting(true);
    try {
      const providerData = {
        name: form.name,
        email: form.email,
        phone: form.phone,
        plan: form.plan,
        password: generateTempPassword(),
        provider_type: "valet_provider",
        address: form.address,
        city: form.city,
        state: form.state,
        max_events: parseInt(form.max_events) || 0,
        max_hotels: parseInt(form.max_hotels) || 0,
        max_cars: parseInt(form.max_cars) || 0
      };
      
      const { data: newProvider } = await api.post("/providers", providerData);
      
      setCreated(newProvider);
      setForm({
        name: "", email: "", phone: "", plan: "starter", password: "",
        provider_type: "valet_provider", address: "", city: "", state: "",
        max_events: 0, max_hotels: 0, max_cars: 0
      });
      setErrors({});
      load();
      toast.success("Provider created successfully");
    } catch (err) { 
      toast.error(err.response?.data?.detail || "Failed to create provider"); 
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SuperLayout title="Providers">
      <div className="flex flex-wrap items-center gap-3 justify-between mb-6">
        <div>
          <h1 className="font-heading text-2xl font-bold text-[#0F2044]">Valet Providers</h1>
          <p className="text-gray-500 text-sm">Valet companies managing parking operations.</p>
        </div>
        <button onClick={() => { setOpen(true); setCreated(null); setErrors({}); }} data-testid="add-provider-btn"
                className="flex items-center gap-2 btn-primary-navy rounded-xl px-4 py-2.5 font-medium text-sm">
          <Plus className="w-4 h-4" /> Add Valet Provider
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-4 mb-5 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]" ref={searchRef}>
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input data-testid="provider-search-input" value={q} 
                 onChange={(e) => { setQ(e.target.value); setShowSuggestions(true); }}
                 onFocus={() => setShowSuggestions(true)}
                 onKeyDown={(e) => { if (e.key === "Escape") setShowSuggestions(false); }}
                 placeholder="Search by name or email"
                 className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 outline-none focus:border-[#1A3C6E]" />
          
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden">
              {suggestions.map(s => (
                <div key={s.id} onClick={() => { setQ(s.name); setShowSuggestions(false); }}
                     className="px-[14px] py-[10px] hover:bg-[#F9FAFB] cursor-pointer transition-colors border-b border-gray-50 last:border-0">
                  <div className="text-[#0F2044] font-bold text-sm">{s.name}</div>
                  <div className="text-[#9CA3AF] text-xs">{s.email}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {["all", "active", "inactive"].map(f => (
            <button key={f} onClick={() => setFilter(f)} data-testid={`filter-${f}`}
                    className={`px-3 py-1.5 rounded-lg text-sm capitalize ${filter === f ? "bg-[#1A3C6E] text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>{f}</button>
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
          icon={<Building2 className="w-8 h-8" />}
          title="No valet providers yet"
          subtitle="Add a valet provider to start onboarding parking operations."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((r) => (
            <div 
              key={r.id} 
              onClick={() => nav(`/superadmin/providers/${r.id}`)} 
              className="bg-white rounded-2xl shadow-card border border-gray-100 p-4 cursor-pointer hover:shadow-md transition-all" 
            > 
              {/* Top row — avatar + name/email + status badge */} 
              <div className="flex flex-wrap items-center gap-3"> 
                <div className="w-10 h-10 rounded-full bg-[#0F2044] flex items-center justify-center shrink-0"> 
                  <span className="text-white font-bold text-sm"> 
                    {r.name?.slice(0,2).toUpperCase()} 
                  </span> 
                </div> 
                <div className="flex-1 min-w-0"> 
                  <div className="flex items-center justify-between gap-2"> 
                    <span className="font-bold text-[#0F2044] text-sm truncate">{r.name}</span> 
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold ${(r.is_verified && r.is_active) ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}> 
                      {(r.is_verified && r.is_active) ? "Active" : "Inactive"} 
                    </span> 
                    {
  r.is_verified ? (
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
                  <span className="text-gray-400 text-xs truncate block">{r.email}</span> 
                </div> 
              </div> 
            
              {/* Bottom row — phone + plan badge + created date */} 
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-50"> 
                <span className="text-gray-500 text-xs">{r.phone}</span> 
                <div className="flex items-center gap-2"> 
                  <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-medium capitalize">{r.plan || "starter"}</span> 
                  {r.provider_type === "hotel_owner" ? (
                    <span className="text-[10px] bg-[#1D4ED8] text-white px-2 py-0.5 rounded-full font-bold">Hotel</span>
                  ) : (
                    <span className="text-[10px] bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full font-bold">Valet</span>
                  )}
                  <span className="text-gray-400 text-xs">{fmtDate(r.created_at)}</span>
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
                <h3 className="font-heading text-xl font-bold text-[#0F2044]">Provider Created</h3>
                <p className="text-sm text-gray-500 mt-1">Share these credentials securely.</p>
                <div className="mt-5 space-y-2 text-sm bg-gray-50 rounded-xl p-4 font-mono">
                  <div><span className="text-gray-500">Name:</span> {created.name}</div>
                  <div><span className="text-gray-500">Email:</span> {created.email}</div>
                  {/* <div><span className="text-gray-500">Password:</span> {created.password}</div> */}
                </div>
                <button onClick={() => { setOpen(false); setErrors({}); }} data-testid="close-created-modal"
                        className="mt-5 w-full btn-primary-navy rounded-xl py-2.5 font-medium">Done</button>
              </>
            ) : (
              <form onSubmit={submit}>
                <h3 className="font-heading text-xl font-bold text-[#0F2044] mb-6">Add New Valet Provider</h3>
                
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      ["Name", "name", "text"],
                      ["Email", "email", "email"],
                      ["Phone", "phone", "tel"],
                    ].map(([l, k, t]) => (
                      <div key={k}>
                        <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">{l} <span className="text-red-500">*</span></label>
                        <input ref={el => { if (fieldRefs.current) fieldRefs.current[k] = el; }}  data-testid={`provider-${k}-input`} type={t} value={form[k]}
                               onChange={(e) => {
                                 let val = e.target.value;
                                 if (k === "phone") val = val.replace(/\D/g, "").slice(0, 10);
                                 setForm({ ...form, [k]: val });
                                 if (errors[k]) setErrors(prev => ({ ...prev, [k]: undefined }));
                               }}
                               maxLength={k === "phone" ? 10 : undefined}
                               inputMode={k === "phone" ? "numeric" : undefined}
                               className={`mt-1 w-full px-3 py-2 rounded-xl border outline-none focus:border-[#1A3C6E] transition-colors ${errors[k] ? "border-red-400" : "border-gray-200"}`} />
                        {errors[k] && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors[k]}</p>}
                      </div>
                    ))}
                    <div>
                      <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Address <span className="text-red-500">*</span></label>
                      <input ref={el => { if (fieldRefs.current) fieldRefs.current.address = el; }}  data-testid="provider-address-input" type="text" value={form.address}
                             onChange={(e) => { setForm({ ...form, address: e.target.value }); if (errors.address) setErrors(prev => ({ ...prev, address: undefined })); }}
                             className={`mt-1 w-full px-3 py-2 rounded-xl border outline-none focus:border-[#1A3C6E] transition-colors ${errors.address ? "border-red-400" : "border-gray-200"}`} />
                      {errors.address && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.address}</p>}
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">State <span className="text-red-500">*</span></label>
                      <select ref={el => { if (fieldRefs.current) fieldRefs.current.state = el; }} 
                        value={form.state || ""}
                        onChange={e => { setForm(prev => ({ ...prev, state: e.target.value, city: "" })); if (errors.state) setErrors(prev => ({ ...prev, state: undefined })); }}
                        className={`mt-1 w-full px-3 py-2 rounded-xl border outline-none focus:border-[#1A3C6E] transition-colors bg-white ${errors.state ? "border-red-400" : "border-gray-200"}`}
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
                        className={`mt-1 w-full px-3 py-2 rounded-xl border outline-none focus:border-[#1A3C6E] transition-colors bg-white disabled:opacity-50 disabled:cursor-not-allowed ${errors.city ? "border-red-400" : "border-gray-200"}`}
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
                    {/* <div>
                      <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Password (min 8) <span className="text-red-500">*</span></label>
                      <input ref={el => { if (fieldRefs.current) fieldRefs.current.password = el; }}  data-testid="provider-password-input" type="text" value={form.password}
                             onChange={(e) => { setForm({ ...form, password: e.target.value }); if (errors.password) setErrors(prev => ({ ...prev, password: undefined })); }}
                             className={`mt-1 w-full px-3 py-2 rounded-xl border outline-none focus:border-[#1A3C6E] transition-colors ${errors.password ? "border-red-400" : "border-gray-200"}`} />
                      {errors.password && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.password}</p>}
                    </div> */}
                  </div>

                  <div className="flex items-center gap-4 py-2">
                    <div className="flex-1">
                      <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Plan</label>
                      <select data-testid="provider-plan-input" value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}
                              className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 outline-none focus:border-[#1A3C6E]">
                        <option value="starter">Starter</option>
                        <option value="pro">Pro</option>
                      </select>
                    </div>
                  </div>
                  
                  <div className="col-span-1 sm:col-span-2 mt-2 mb-1">
                    <h4 className="text-sm font-bold text-[#1A3C6E] border-b pb-2">Limits</h4>
                    <p className="text-[11px] text-gray-400 mt-1">Leave Events/Hotels as 0 to keep this provider blocked until limits are set.</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-2">
                    <div>
                      <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Max Events</label>
                      <input ref={el => { if (fieldRefs.current) fieldRefs.current.max_events = el; }}  type="number" min="0" value={form.max_events} onChange={(e) => { setForm({ ...form, max_events: e.target.value }); if (errors.max_events) setErrors(prev => ({ ...prev, max_events: undefined })); }}
                             className={`mt-1 w-full px-3 py-2 rounded-xl border outline-none focus:border-[#1A3C6E] transition-colors ${errors.max_events ? "border-red-400" : "border-gray-200"}`} />
                      {errors.max_events && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.max_events}</p>}
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Max Hotels/Stores</label>
                      <input ref={el => { if (fieldRefs.current) fieldRefs.current.max_hotels = el; }}  type="number" min="0" value={form.max_hotels} onChange={(e) => { setForm({ ...form, max_hotels: e.target.value }); if (errors.max_hotels) setErrors(prev => ({ ...prev, max_hotels: undefined })); }}
                             className={`mt-1 w-full px-3 py-2 rounded-xl border outline-none focus:border-[#1A3C6E] transition-colors ${errors.max_hotels ? "border-red-400" : "border-gray-200"}`} />
                      {errors.max_hotels && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.max_hotels}</p>}
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Expected Cars</label>
                      <input ref={el => { if (fieldRefs.current) fieldRefs.current.max_cars = el; }}  type="number" min="0" value={form.max_cars} onChange={(e) => { setForm({ ...form, max_cars: e.target.value }); if (errors.max_cars) setErrors(prev => ({ ...prev, max_cars: undefined })); }}
                             className={`mt-1 w-full px-3 py-2 rounded-xl border outline-none focus:border-[#1A3C6E] transition-colors ${errors.max_cars ? "border-red-400" : "border-gray-200"}`} />
                      <p className="text-[10px] text-gray-400 mt-1 italic">Estimate only — check-in isn't blocked once this is reached.</p>
                      {errors.max_cars && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.max_cars}</p>}
                    </div>
                  </div>
                </div>

                <p className="text-xs text-gray-400 mb-2"><span className="text-red-500">*</span> Required fields</p>
                  <div className="mt-8 flex flex-wrap gap-3">
                  <button type="button" disabled={submitting} onClick={() => { setOpen(false); setErrors({}); }} 
                          className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed">Cancel</button>
                  <button type="submit" data-testid="submit-provider-btn" disabled={submitting}
                          className="flex-1 btn-primary-navy rounded-xl py-2.5 font-medium shadow-lg shadow-[#1A3C6E]/20 disabled:opacity-60 disabled:cursor-not-allowed">
                    {submitting ? "Creating..." : "Create Account"}
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
