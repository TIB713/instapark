import { useEffect, useState, useMemo, useRef } from "react";
import OwnerLayout from "@/components/layout/OwnerLayout";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { ShieldCheck, Plus, Search, User, Mail, AlertTriangle, Edit2, Check, X, Trash2 } from "lucide-react";
import SkeletonTable from "@/components/ui/SkeletonTable";
import EmptyState from "@/components/ui/EmptyState";
import StatusBadge from "@/components/ui/StatusBadge";

import { useScrollToFirstError } from "../../hooks/useScrollToFirstError";

const generateTempPassword = () => Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10).toUpperCase() + "1!";

export default function OwnerAdmins() {
  const addFieldRefs = useRef({});
  const scrollToFirstAddError = useScrollToFirstError(["name", "email", "phone"], addFieldRefs);

  const editFieldRefs = useRef({});
  const scrollToFirstEditError = useScrollToFirstError(["name", "email", "phone"], editFieldRefs);
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({ name: "", email: "", phone: "" });
  const [saving, setSaving] = useState(false);

  const [showEditModal, setShowEditModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editFormData, setEditFormData] = useState({ name: "", email: "", phone: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [editErrors, setEditErrors] = useState({});
  const [errors, setErrors] = useState({});

  const loadAdmins = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/providers");
      setAdmins(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error("Failed to load admins");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAdmins(); }, []);

  const filtered = useMemo(() => {
    return admins.filter(a => !q || a.name.toLowerCase().includes(q.toLowerCase()) || a.email?.toLowerCase().includes(q.toLowerCase()));
  }, [admins, q]);

  const validate = () => {
    const errs = {};
    if (!formData.name.trim()) errs.name = "Name is required";
    if (!formData.email.trim()) errs.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) errs.email = "Enter a valid email address";
    if (!formData.phone.trim()) errs.phone = "Phone number is required";
    else if (!/^\d{10}$/.test(formData.phone.trim())) errs.phone = "Phone must be exactly 10 digits";
    return errs;
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      scrollToFirstAddError(errs);
      return;
    }

    setSaving(true);
    try {
      await api.post("/providers", {
        name: formData.name.trim(),
        email: formData.email.trim().toLowerCase(),
        phone: formData.phone.trim(),
        password: generateTempPassword()
      });
      toast.success("Admin invited successfully!");
      setErrors({});
      setShowModal(false);
      setFormData({ name: "", email: "", phone: "" });
      loadAdmins();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to invite admin");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (id, currentStatus) => {
    const action = currentStatus !== false ? "deactivate" : "reactivate";
    if (!window.confirm(`Are you sure you want to ${action} this admin?`)) return;
    try {
      await api.patch(`/providers/${id}`, { is_active: !currentStatus });
      toast.success(`Admin ${action}d successfully`);
      loadAdmins();
    } catch (err) {
      toast.error(`Failed to ${action} admin`);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Permanently delete this admin? This cannot be undone.")) return;
    try {
      await api.delete(`/providers/${id}/permanent`);
      toast.success("Admin deleted");
      loadAdmins();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to delete admin");
    }
  };

  const startEdit = (admin) => {
    setEditingId(admin.id);
    setEditFormData({ name: admin.name || "", email: admin.email || "", phone: admin.phone || "" });
    setEditErrors({});
    setShowEditModal(true);
  };

  const validateEdit = () => {
    const errs = {};
    if (!editFormData.name.trim()) errs.name = "Name is required";
    if (!editFormData.email.trim()) errs.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editFormData.email.trim())) errs.email = "Enter a valid email address";
    if (!editFormData.phone.trim()) errs.phone = "Phone number is required";
    else if (!/^\d{10}$/.test(editFormData.phone.trim())) errs.phone = "Phone must be exactly 10 digits";
    return errs;
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    const errs = validateEdit();
    setEditErrors(errs);
    if (Object.keys(errs).length > 0) {
      scrollToFirstEditError(errs);
      return;
    }

    setEditSaving(true);
    try {
      await api.patch(`/providers/${editingId}`, { 
        name: editFormData.name.trim(),
        email: editFormData.email.trim().toLowerCase(),
        phone: editFormData.phone.trim()
      });
      toast.success("Admin updated successfully!");
      setShowEditModal(false);
      setEditingId(null);
      loadAdmins();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to update admin");
    } finally {
      setEditSaving(false);
    }
  };



  return (
    <OwnerLayout title="Admins">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-[#0F2044]">Admins</h1>
          <p className="text-gray-500 text-sm mt-1">Manage sub-accounts for your staff.</p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary-navy px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2">
          <Plus className="w-4 h-4" /> Invite Admin
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden fade-in-up">
        <div className="p-4 border-b border-gray-100 bg-gray-50/50">
          <div className="relative w-full max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name or email..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm rounded-xl border border-gray-200 focus:border-[#1A3C6E] focus:ring-1 focus:ring-[#1A3C6E] outline-none"
            />
          </div>
        </div>

        {loading ? (
          <SkeletonTable rows={4} columns={4} />
        ) : filtered.length === 0 ? (
          <EmptyState theme="owner" icon={<ShieldCheck className="w-8 h-8" />} title="No Admins Found" description={q ? "No admins match your search." : "You haven't added any admins yet."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-[#0F2044]/[0.04] text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100">
                  <th className="px-6 py-4">Name</th>
                  <th className="px-6 py-4">Email</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(admin => (
                  <tr key={admin.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-[#0F2044]">{admin.name}</div>
                    </td>
                    <td className="px-6 py-4 text-gray-600 flex items-center gap-2">
                      <Mail className="w-3.5 h-3.5 text-gray-400" /> {admin.email}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={(admin.is_verified && admin.is_active !== false) ? "active" : "inactive"} />
                        {admin.is_verified === false ? (
                          <span className="text-[10px] uppercase font-bold tracking-wider text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">Pending Setup</span>
                        ) : (
                          <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">Verified</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => startEdit(admin)} className="p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 rounded-lg transition" title="Edit Name">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleToggleStatus(admin.id, admin.is_active)}
                          className={`p-2 rounded-lg transition ${admin.is_active !== false ? "text-red-500 hover:bg-red-50" : "text-emerald-600 hover:bg-emerald-50"}`}
                          title={admin.is_active !== false ? "Deactivate" : "Reactivate"}
                        >
                          <AlertTriangle className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(admin.id)}
                          className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition"
                          title="Delete Admin"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden fade-in-up" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-5 border-b border-gray-100 bg-[#0F2044] text-white flex justify-between items-center">
              <h2 className="font-heading text-lg font-bold">Invite Admin</h2>
              <button onClick={() => { setShowModal(false); setErrors({}); }} className="text-white/60 hover:text-white transition"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleInvite} className="p-6">
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1 block">
                    Full Name <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input ref={el => { if (addFieldRefs.current) addFieldRefs.current.name = el; }}  type="text" value={formData.name} onChange={e => { setFormData({ ...formData, name: e.target.value }); if (errors.name) setErrors(prev => ({ ...prev, name: undefined })); }}
                      className={`w-full pl-9 pr-3 py-2 rounded-xl border outline-none focus:border-[#1A3C6E] ${errors.name ? "border-red-400" : "border-gray-200"}`} placeholder="Jane Doe" />
                  </div>
                  {errors.name && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.name}</p>}
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1 block">
                    Email Address <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input ref={el => { if (addFieldRefs.current) addFieldRefs.current.email = el; }}  type="email" value={formData.email} onChange={e => { setFormData({ ...formData, email: e.target.value }); if (errors.email) setErrors(prev => ({ ...prev, email: undefined })); }}
                      className={`w-full pl-9 pr-3 py-2 rounded-xl border outline-none focus:border-[#1A3C6E] ${errors.email ? "border-red-400" : "border-gray-200"}`} placeholder="jane@example.com" />
                  </div>
                  {errors.email && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.email}</p>}
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1 block">
                    Phone Number <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input ref={el => { if (addFieldRefs.current) addFieldRefs.current.phone = el; }}  type="text" value={formData.phone} onChange={e => { setFormData({ ...formData, phone: e.target.value }); if (errors.phone) setErrors(prev => ({ ...prev, phone: undefined })); }}
                      className={`w-full px-3 py-2 rounded-xl border outline-none focus:border-[#1A3C6E] ${errors.phone ? "border-red-400" : "border-gray-200"}`} placeholder="1234567890" maxLength={10} />
                  </div>
                  {errors.phone && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.phone}</p>}
                </div>
              </div>
              <p className="text-[13px] text-gray-500 mt-4">They will receive an email to set their password and log in.</p>
              <div className="mt-8 flex items-center justify-end gap-3">
                <button type="button" onClick={() => { setShowModal(false); setErrors({}); }} className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-100">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary-navy px-6 py-2 rounded-xl text-sm font-bold shadow-md disabled:opacity-60 flex items-center gap-2">
                  {saving ? <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" /> : "Send Invite"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowEditModal(false)}>
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden fade-in-up" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-5 border-b border-gray-100 bg-[#0F2044] text-white flex justify-between items-center">
              <h2 className="font-heading text-lg font-bold">Edit Admin</h2>
              <button onClick={() => { setShowEditModal(false); setEditErrors({}); }} className="text-white/60 hover:text-white transition"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSaveEdit} className="p-6">
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1 block">
                    Full Name <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input ref={el => { if (editFieldRefs.current) editFieldRefs.current.name = el; }}  type="text" value={editFormData.name} onChange={e => { setEditFormData({ ...editFormData, name: e.target.value }); if (editErrors.name) setEditErrors(prev => ({ ...prev, name: undefined })); }}
                      className={`w-full pl-9 pr-3 py-2 rounded-xl border outline-none focus:border-[#1A3C6E] ${editErrors.name ? "border-red-400" : "border-gray-200"}`} placeholder="Jane Doe" />
                  </div>
                  {editErrors.name && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.name}</p>}
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1 block">
                    Email Address <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input ref={el => { if (editFieldRefs.current) editFieldRefs.current.email = el; }}  type="email" value={editFormData.email} onChange={e => { setEditFormData({ ...editFormData, email: e.target.value }); if (editErrors.email) setEditErrors(prev => ({ ...prev, email: undefined })); }}
                      className={`w-full pl-9 pr-3 py-2 rounded-xl border outline-none focus:border-[#1A3C6E] ${editErrors.email ? "border-red-400" : "border-gray-200"}`} placeholder="jane@example.com" />
                  </div>
                  {editErrors.email && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.email}</p>}
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1 block">
                    Phone Number <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input ref={el => { if (editFieldRefs.current) editFieldRefs.current.phone = el; }}  type="text" value={editFormData.phone} onChange={e => { setEditFormData({ ...editFormData, phone: e.target.value }); if (editErrors.phone) setEditErrors(prev => ({ ...prev, phone: undefined })); }}
                      className={`w-full px-3 py-2 rounded-xl border outline-none focus:border-[#1A3C6E] ${editErrors.phone ? "border-red-400" : "border-gray-200"}`} placeholder="1234567890" maxLength={10} />
                  </div>
                  {editErrors.phone && <p className="text-[11px] text-red-500 mt-1 font-medium">* {editErrors.phone}</p>}
                </div>
              </div>
              <div className="mt-8 flex items-center justify-end gap-3">
                <button type="button" onClick={() => { setShowEditModal(false); setEditErrors({}); }} className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-100">Cancel</button>
                <button type="submit" disabled={editSaving} className="btn-primary-navy px-6 py-2 rounded-xl text-sm font-bold shadow-md disabled:opacity-60 flex items-center gap-2">
                  {editSaving ? <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" /> : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </OwnerLayout>
  );
}
