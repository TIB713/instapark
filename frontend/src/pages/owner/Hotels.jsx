import { useEffect, useState, useMemo, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import OwnerLayout from "@/components/layout/OwnerLayout";
import { api } from "@/lib/api";
import { Hotel, Search, MapPin, Plus, X, Camera, Trash2 } from "lucide-react";
import SkeletonTable from "@/components/ui/SkeletonTable";
import EmptyState from "@/components/ui/EmptyState";
import StatusBadge from "@/components/ui/StatusBadge";
import { toast } from "sonner";
import { State, City } from "country-state-city";
import { createPortal } from "react-dom";

import { useScrollToFirstError } from "../../hooks/useScrollToFirstError";

export default function OwnerHotels() {
  const fieldRefs = useRef({});

  const scrollToFirstError = useScrollToFirstError(["name", "address", "state", "city", "contact_person_name", "contact_person_phone", "contact_person_email", "total_valet_slots"], fieldRefs);
  const [hotels, setHotels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const nav = useNavigate();

  const [hotelModal, setHotelModal] = useState(false);
  const [hotelErrors, setHotelErrors] = useState({});
  const [uploadingHotelPhoto, setUploadingHotelPhoto] = useState(false);
  const [savingHotel, setSavingHotel] = useState(false);
  const [zones, setZones] = useState([{ name: "A", slots: "" }]);
  const [gates, setGates] = useState(["Main Gate"]);
  const [hotelForm, setHotelForm] = useState({
    name: "", address: "", city: "", state: "",
    contact_person_name: "", contact_person_phone: "", contact_person_email: "",
    total_valet_slots: "",
    gate_timer_minutes: "5",
    hotel_photo: ""
  });

  const totalHotelSlots = useMemo(() => zones.reduce((sum, z) => sum + (parseInt(z.slots) || 0), 0), [zones]);

  useEffect(() => {
    if (zones.length === 1 && hotelForm.total_valet_slots) {
      setZones([{ ...zones[0], slots: hotelForm.total_valet_slots }]);
    }
  }, [hotelForm.total_valet_slots]);

  useEffect(() => {
    if (!hotelModal) return;
    const handleEsc = (e) => {
      if (e.key === "Escape") setHotelModal(false);
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [hotelModal]);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/hotels");
      setHotels(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleHotelPhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingHotelPhoto(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "hotels");
      const { data } = await api.post("/upload", fd);
      setHotelForm(prev => ({ ...prev, hotel_photo: data.url }));
      toast.success("Hotel photo uploaded");
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploadingHotelPhoto(false);
    }
  };

  const validateHotel = () => {
    const errs = {};
    if (!hotelForm.name.trim()) errs.name = "Hotel name is required";
    if (!hotelForm.address.trim()) errs.address = "Address is required";
    if (!hotelForm.state) errs.state = "State is required";
    if (!hotelForm.city) errs.city = "City is required";
    if (!hotelForm.contact_person_name.trim()) errs.contact_person_name = "Contact person name is required";
    if (!hotelForm.contact_person_phone.trim()) errs.contact_person_phone = "Contact person phone is required";
    else if (!/^\d{10}$/.test(hotelForm.contact_person_phone.replace(/\D/g, ""))) errs.contact_person_phone = "Please enter a valid 10-digit phone number";
    if (hotelForm.contact_person_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hotelForm.contact_person_email.trim())) errs.contact_person_email = "Please enter a valid email address";
    if (!hotelForm.total_valet_slots || isNaN(parseInt(hotelForm.total_valet_slots)) || parseInt(hotelForm.total_valet_slots) <= 0) errs.total_valet_slots = "Total valet slots must be a number greater than 0";
    return errs;
  };

  const submitHotel = async (e) => {
    e.preventDefault();
    if (savingHotel) return;
    const errs = validateHotel();
    setHotelErrors(errs);
    if (Object.keys(errs).length > 0) {
      scrollToFirstError(errs);
      return;
    }
    setSavingHotel(true);
    try {
      const body = {
        ...hotelForm,
        state: hotelForm.state,
        total_valet_slots: parseInt(hotelForm.total_valet_slots),
        zones: zones.map(z => ({ name: z.name.trim(), slots: parseInt(z.slots) || 0 })).filter(z => z.name),
        gates: gates.filter(g => g.trim()),
      };
      await api.post("/hotels", body);
      toast.success("Hotel created successfully");
      setHotelErrors({});
      setHotelModal(false);
      setZones([{ name: "A", slots: "" }]);
      setGates(["Main Gate"]);
      setHotelForm({
        name: "", address: "", city: "", state: "",
        contact_person_name: "", contact_person_phone: "", contact_person_email: "",
        total_valet_slots: "",
        gate_timer_minutes: "5",
        hotel_photo: ""
      });
      load();
    } catch (err) {
      const detail = err.response?.data?.detail;
      let message = "Failed to create hotel";
      if (typeof detail === "string") {
        message = detail;
      } else if (Array.isArray(detail) && detail.length > 0) {
        message = detail.map(d => d.msg || JSON.stringify(d)).join(", ");
      }
      toast.error(message);
    } finally {
      setSavingHotel(false);
    }
  };

  const filtered = useMemo(() => {
    return hotels.filter(h =>
      !search || h.name.toLowerCase().includes(search.toLowerCase()) || h.city?.toLowerCase().includes(search.toLowerCase())
    );
  }, [hotels, search]);

  return (
    <OwnerLayout title="Hotels">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-[#0F2044]">Hotels</h1>
          <p className="text-gray-500 text-sm mt-1">View and manage your hotel operations.</p>
        </div>
        <button
          onClick={() => setHotelModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[#0F2044] text-white rounded-xl text-sm font-bold hover:bg-[#1A3C6E] transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" /> Add Hotel
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden fade-in-up">
        <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
          <div className="relative w-full max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by hotel name or city..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm rounded-xl border border-gray-200 focus:border-[#1A3C6E] focus:ring-1 focus:ring-[#1A3C6E] outline-none"
            />
          </div>
          <span className="text-xs font-semibold text-gray-500 bg-gray-200/50 px-2.5 py-1 rounded-full ml-4 shrink-0">
            {filtered.length} Hotels
          </span>
        </div>

        {loading ? (
          <SkeletonTable rows={5} columns={4} />
        ) : filtered.length === 0 ? (
          <EmptyState theme="owner" icon={<Hotel className="w-8 h-8" />} title="No Hotels Found" description={search ? "Try adjusting your search filters." : "You do not have any hotels assigned to your account."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#0F2044]/[0.04] text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100">
                  <th className="px-6 py-4">Hotel Name</th>
                  <th className="px-6 py-4">Location</th>
                  <th className="px-6 py-4">Valet Slots</th>
                  <th className="px-6 py-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm">
                {filtered.map(hotel => (
                  <tr
                    key={hotel.id}
                    onClick={() => nav(`/provider/hotels/${hotel.id}`)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="font-semibold text-gray-900">{hotel.name}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{hotel.address}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5 text-gray-600">
                        <MapPin className="w-3.5 h-3.5 text-gray-400" />
                        {hotel.city}, {hotel.state}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-700">{hotel.total_valet_slots}</div>
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={hotel.is_active !== false ? "active" : "inactive"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {hotelModal && createPortal(
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center overflow-y-auto pt-8 pb-8" onClick={() => setHotelModal(false)}>
          <div
            className="relative bg-white rounded-2xl shadow-2xl max-w-xl w-full mx-4 animate-in fade-in slide-in-from-top-4 duration-300 flex flex-col mb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0 bg-[#0F2044] rounded-t-2xl">
              <h3 className="font-heading text-xl font-bold text-white">Add New Hotel</h3>
              <button type="button" onClick={() => setHotelModal(false)} className="text-white/70 hover:text-white transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            <form onSubmit={submitHotel} className="px-6 py-4">

              <div className="space-y-4">
                {/* Hotel Photo */}
                <div className="flex flex-col items-center mb-6">
                  <div className="relative group">
                    <label className="cursor-pointer flex flex-col items-center gap-2">
                      <div className="w-24 h-24 rounded-2xl bg-gray-50 border-2 border-dashed border-gray-200 flex items-center justify-center overflow-hidden group-hover:border-[#1A3C6E] transition-colors">
                        {hotelForm.hotel_photo ? (
                          <img src={hotelForm.hotel_photo} className="w-full h-full object-cover" alt="Hotel" />
                        ) : (
                          <Camera className="w-8 h-8 text-gray-300 group-hover:text-[#1A3C6E] transition-colors" />
                        )}
                      </div>
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                        {uploadingHotelPhoto ? "Uploading..." : "Hotel Photo"}
                      </span>
                      <input type="file" className="hidden" accept="image/*" onChange={handleHotelPhotoUpload} disabled={uploadingHotelPhoto} />
                    </label>
                    {hotelForm.hotel_photo && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setHotelForm(prev => ({ ...prev, hotel_photo: null }));
                        }}
                        className="absolute top-0 right-0 translate-x-2 -translate-y-2 w-6 h-6 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-400 hover:text-red-500 hover:border-red-200 transition-all z-10"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Hotel Name */}
                <div>
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Hotel Name <span className="text-red-500">*</span></label>
                  <input ref={el => { if (fieldRefs.current) fieldRefs.current.name = el; }}  type="text" value={hotelForm.name}
                    onChange={(e) => { setHotelForm({ ...hotelForm, name: e.target.value }); if (hotelErrors.name) setHotelErrors(prev => ({ ...prev, name: undefined })); }}
                    className={`mt-1 w-full px-4 py-2 rounded-xl border ${hotelErrors.name ? "border-red-400" : "border-gray-200"} outline-none focus:border-[#1A3C6E] transition-colors`} />
                  {hotelErrors.name && <p className="text-[11px] text-red-500 mt-1 font-medium">* {hotelErrors.name}</p>}
                </div>

                {/* Address */}
                <div>
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Address <span className="text-red-500">*</span></label>
                  <input ref={el => { if (fieldRefs.current) fieldRefs.current.address = el; }}  type="text" value={hotelForm.address}
                    onChange={(e) => { setHotelForm({ ...hotelForm, address: e.target.value }); if (hotelErrors.address) setHotelErrors(prev => ({ ...prev, address: undefined })); }}
                    className={`mt-1 w-full px-4 py-2 rounded-xl border ${hotelErrors.address ? "border-red-400" : "border-gray-200"} outline-none focus:border-[#1A3C6E] transition-colors`} />
                  {hotelErrors.address && <p className="text-[11px] text-red-500 mt-1 font-medium">* {hotelErrors.address}</p>}
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">State <span className="text-red-500">*</span></label>
                  <select ref={el => { if (fieldRefs.current) fieldRefs.current.state = el; }} 
                    value={hotelForm.state || ""}
                    onChange={e => { setHotelForm(prev => ({ ...prev, state: e.target.value, city: "" })); if (hotelErrors.state) setHotelErrors(prev => ({ ...prev, state: undefined })); }}
                    className={`mt-1 w-full px-4 py-2 rounded-xl border ${hotelErrors.state ? "border-red-400" : "border-gray-200"} outline-none focus:border-[#1A3C6E] transition-colors`}
                  >
                    <option value="">Select State</option>
                    {State.getStatesOfCountry("IN").map(s => (
                      <option key={s.isoCode} value={s.name}>{s.name}</option>
                    ))}
                  </select>
                  {hotelErrors.state && <p className="text-[11px] text-red-500 mt-1 font-medium">* {hotelErrors.state}</p>}
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">City <span className="text-red-500">*</span></label>
                  <select ref={el => { if (fieldRefs.current) fieldRefs.current.city = el; }} 
                    value={hotelForm.city || ""}
                    onChange={e => { setHotelForm(prev => ({ ...prev, city: e.target.value })); if (hotelErrors.city) setHotelErrors(prev => ({ ...prev, city: undefined })); }}
                    disabled={!hotelForm.state}
                    className={`mt-1 w-full px-4 py-2 rounded-xl border ${hotelErrors.city ? "border-red-400" : "border-gray-200"} outline-none focus:border-[#1A3C6E] transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <option value="">Select City</option>
                    {(hotelForm.state
                      ? City.getCitiesOfState("IN", State.getStatesOfCountry("IN").find(s => s.name === hotelForm.state)?.isoCode || "")
                      : []
                    ).map(c => (
                      <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                  {hotelErrors.city && <p className="text-[11px] text-red-500 mt-1 font-medium">* {hotelErrors.city}</p>}
                </div>

                {/* Contact Info */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Contact Person Name <span className="text-red-500">*</span></label>
                    <input ref={el => { if (fieldRefs.current) fieldRefs.current.contact_person_name = el; }}  type="text" value={hotelForm.contact_person_name}
                      onChange={(e) => { setHotelForm({ ...hotelForm, contact_person_name: e.target.value }); if (hotelErrors.contact_person_name) setHotelErrors(prev => ({ ...prev, contact_person_name: undefined })); }}
                      className={`mt-1 w-full px-4 py-2 rounded-xl border ${hotelErrors.contact_person_name ? "border-red-400" : "border-gray-200"} outline-none focus:border-[#1A3C6E] transition-colors`} />
                    {hotelErrors.contact_person_name && <p className="text-[11px] text-red-500 mt-1 font-medium">* {hotelErrors.contact_person_name}</p>}
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Contact Person Phone <span className="text-red-500">*</span></label>
                    <input ref={el => { if (fieldRefs.current) fieldRefs.current.contact_person_phone = el; }}  type="tel" value={hotelForm.contact_person_phone} inputMode="numeric"
                      onChange={(e) => { setHotelForm({ ...hotelForm, contact_person_phone: e.target.value.replace(/\D/g, "").slice(0, 10) }); if (hotelErrors.contact_person_phone) setHotelErrors(prev => ({ ...prev, contact_person_phone: undefined })); }}
                      className={`mt-1 w-full px-4 py-2 rounded-xl border ${hotelErrors.contact_person_phone ? "border-red-400" : "border-gray-200"} outline-none focus:border-[#1A3C6E] transition-colors`} />
                    {hotelErrors.contact_person_phone && <p className="text-[11px] text-red-500 mt-1 font-medium">* {hotelErrors.contact_person_phone}</p>}
                  </div>
                </div>

                {/* Contact Email */}
                <div>
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Contact Person Email (optional)</label>
                  <input ref={el => { if (fieldRefs.current) fieldRefs.current.contact_person_email = el; }}  type="email" value={hotelForm.contact_person_email}
                    onChange={(e) => { setHotelForm({ ...hotelForm, contact_person_email: e.target.value }); if (hotelErrors.contact_person_email) setHotelErrors(prev => ({ ...prev, contact_person_email: undefined })); }}
                    className={`mt-1 w-full px-4 py-2 rounded-xl border ${hotelErrors.contact_person_email ? "border-red-400" : "border-gray-200"} outline-none focus:border-[#1A3C6E] transition-colors`} />
                  {hotelErrors.contact_person_email && <p className="text-[11px] text-red-500 mt-1 font-medium">* {hotelErrors.contact_person_email}</p>}
                </div>

                {/* Slots */}
                <div>
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Total Valet Slots <span className="text-red-500">*</span></label>
                  <input ref={el => { if (fieldRefs.current) fieldRefs.current.total_valet_slots = el; }}  type="number" value={hotelForm.total_valet_slots}
                    onChange={(e) => { setHotelForm({ ...hotelForm, total_valet_slots: e.target.value }); if (hotelErrors.total_valet_slots) setHotelErrors(prev => ({ ...prev, total_valet_slots: undefined })); }}
                    className={`mt-1 w-full px-4 py-2 rounded-xl border ${hotelErrors.total_valet_slots ? "border-red-400" : "border-gray-200"} outline-none focus:border-[#1A3C6E] transition-colors`} />
                  {hotelErrors.total_valet_slots && <p className="text-[11px] text-red-500 mt-1 font-medium">* {hotelErrors.total_valet_slots}</p>}
                </div>
                {/* Gate Timer */}
                <div>
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Gate Wait Timer (min)</label>
                  <input type="number" min="1" max="30" value={hotelForm.gate_timer_minutes}
                    onChange={(e) => { setHotelForm({ ...hotelForm, gate_timer_minutes: e.target.value }); if (hotelErrors.gate_timer_minutes) setHotelErrors(prev => ({ ...prev, gate_timer_minutes: undefined })); }}
                    className={`mt-1 w-full px-4 py-2 rounded-xl border ${hotelErrors.gate_timer_minutes ? "border-red-400" : "border-gray-200"} outline-none focus:border-[#1A3C6E] transition-colors`} />
                  {hotelErrors.gate_timer_minutes && <p className="text-[11px] text-red-500 mt-1 font-medium">* {hotelErrors.gate_timer_minutes}</p>}
                </div>

                {/* Gates */}
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
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
                          className="flex-1 px-3 py-2 rounded-xl border border-gray-200 outline-none focus:border-[#1A3C6E] text-sm"
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
                    className="w-full py-2 rounded-xl border border-dashed border-[#0F2044] text-[#0F2044] text-sm font-semibold hover:bg-[#0F2044]/5 transition">
                    + Add Gate
                  </button>
                </div>

                {/* Zones */}
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Parking Zones</label>
                    <span className={`text-xs font-bold ${totalHotelSlots > hotelForm.total_valet_slots ? "text-red-500" : "text-emerald-600"}`}>
                      {totalHotelSlots} / {hotelForm.total_valet_slots || "—"} slots
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
                          className="flex-1 px-3 py-2 rounded-xl border border-gray-200 outline-none focus:border-[#1A3C6E] text-sm"
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
                          className="w-20 px-3 py-2 rounded-xl border border-gray-200 outline-none focus:border-[#1A3C6E] text-sm text-center"
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
                    className="w-full py-2 rounded-xl border border-dashed border-[#0F2044] text-[#0F2044] text-sm font-semibold hover:bg-[#0F2044]/5 transition">
                    + Add Zone
                  </button>
                </div>


              </div>


              <p className="text-xs text-gray-400 mb-2"><span className="text-red-500">*</span> Required fields</p>
              <div className="mt-8 flex gap-3">
                <button type="button" onClick={() => setHotelModal(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 font-medium transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={uploadingHotelPhoto || savingHotel}
                  className="flex-1 bg-[#0F2044] text-white rounded-xl py-2.5 font-medium hover:bg-[#1A3C6E] transition-colors shadow-lg shadow-[#0F2044]/20">
                  {uploadingHotelPhoto ? "Uploading..." : savingHotel ? "Creating..." : "Create Hotel"}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </OwnerLayout>
  );
}
