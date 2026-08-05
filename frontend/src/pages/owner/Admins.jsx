import { useEffect, useState, useMemo } from "react";
import OwnerLayout from "@/components/layout/OwnerLayout";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { ShieldCheck, Plus, Search, User, Mail, AlertTriangle, Edit2, Check, X } from "lucide-react";
import SkeletonTable from "@/components/ui/SkeletonTable";
import EmptyState from "@/components/ui/EmptyState";
import StatusBadge from "@/components/ui/StatusBadge";

const generateTempPassword = () => Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10).toUpperCase() + "1!";

export default function OwnerAdmins() {
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({ name: "", email: "", phone: "" });
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
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
    if (Object.keys(errs).length > 0) return;

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

  const startEdit = (admin) => {
    setEditingId(admin.id);
    setEditName(admin.name);
  };

  const saveEdit = async (id) => {
    if (!editName.trim()) return toast.error("Name cannot be empty");
    try {
      await api.patch(`/providers/${id}`, { name: editName.trim() });
      toast.success("Admin updated");
      setEditingId(null);
      loadAdmins();
    } catch {
      toast.error("Failed to update admin");
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
                      {editingId === admin.id ? (
                        <div className="flex items-center gap-2">
                          <input type="text" value={editName} onChange={e => setEditName(e.target.value)}
                            className="px-2 py-1 text-sm rounded border border-gray-300 outline-none focus:border-[#1A3C6E]" />
                          <button onClick={() => saveEdit(admin.id)} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><Check className="w-4 h-4" /></button>
                          <button onClick={() => setEditingId(null)} className="p-1 text-red-600 hover:bg-red-50 rounded"><X className="w-4 h-4" /></button>
                        </div>
                      ) : (
                        <div className="font-semibold text-[#0F2044]">{admin.name}</div>
                      )}
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
                    <input type="text" value={formData.name} onChange={e => { setFormData({ ...formData, name: e.target.value }); if (errors.name) setErrors(prev => ({ ...prev, name: undefined })); }}
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
                    <input type="email" value={formData.email} onChange={e => { setFormData({ ...formData, email: e.target.value }); if (errors.email) setErrors(prev => ({ ...prev, email: undefined })); }}
                      className={`w-full pl-9 pr-3 py-2 rounded-xl border outline-none focus:border-[#1A3C6E] ${errors.email ? "border-red-400" : "border-gray-200"}`} placeholder="jane@example.com" />
                  </div>
                  {errors.email && <p className="text-[11px] text-red-500 mt-1 font-medium">* {errors.email}</p>}
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1 block">
                    Phone Number <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input type="text" value={formData.phone} onChange={e => { setFormData({ ...formData, phone: e.target.value }); if (errors.phone) setErrors(prev => ({ ...prev, phone: undefined })); }}
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
    </OwnerLayout>
  );
}
