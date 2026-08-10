import { useEffect, useState } from "react";
import SuperLayout from "@/components/layout/SuperLayout";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Plus, Edit2, Trash2, CreditCard } from "lucide-react";
import SkeletonTable from "@/components/ui/SkeletonTable";
import EmptyState from "@/components/ui/EmptyState";

export default function Plans() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  
  const [form, setForm] = useState({
    name: "", max_events: "", max_cars: "", max_hotels: ""
  });

  const fetchPlans = async () => {
    try {
      const { data } = await api.get("/superadmin/plans");
      setPlans(data || []);
    } catch (err) {
      toast.error("Failed to fetch plans");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlans();
  }, []);

  const openNew = () => {
    setEditing(null);
    setForm({ name: "", max_events: "", max_cars: "", max_hotels: "" });
    setOpen(true);
  };

  const openEdit = (plan) => {
    setEditing(plan);
    setForm({
      name: plan.name,
      max_events: plan.max_events,
      max_cars: plan.max_cars,
      max_hotels: plan.max_hotels
    });
    setOpen(true);
  };

  const handleDelete = async (plan) => {
    if (!window.confirm(`Are you sure you want to delete the plan "${plan.name}"?`)) return;
    try {
      await api.delete(`/superadmin/plans/${plan.id}`);
      toast.success("Plan deleted successfully");
      fetchPlans();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to delete plan");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;

    if (!form.name.trim()) return toast.error("Plan name is required");
    if (form.max_events === "" || isNaN(form.max_events)) return toast.error("Max Events is required");
    if (form.max_cars === "" || isNaN(form.max_cars)) return toast.error("Max Cars is required");
    if (form.max_hotels === "" || isNaN(form.max_hotels)) return toast.error("Max Hotels is required");

    const payload = {
      name: form.name.trim(),
      max_events: parseInt(form.max_events, 10),
      max_cars: parseInt(form.max_cars, 10),
      max_hotels: parseInt(form.max_hotels, 10),
    };

    setSaving(true);
    try {
      if (editing) {
        await api.put(`/superadmin/plans/${editing.id}`, payload);
        toast.success("Plan updated successfully");
      } else {
        await api.post("/superadmin/plans", payload);
        toast.success("Plan created successfully");
      }
      setOpen(false);
      fetchPlans();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to save plan");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SuperLayout title="Plans">
      <div className="p-6 max-w-6xl mx-auto fade-in">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-extrabold text-[#0F2044]">Subscription Plans</h1>
            <p className="text-gray-500 text-sm mt-1">Manage plans and limits for providers</p>
          </div>
          <button onClick={openNew} className="btn-primary-navy px-6 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 shrink-0">
            <Plus className="w-4 h-4" /> Add Plan
          </button>
        </div>

        {loading ? (
          <SkeletonTable rows={5} />
        ) : plans.length === 0 ? (
          <EmptyState
            icon={<CreditCard className="w-8 h-8" />}
            title="No plans created yet"
            description="Add your first subscription plan to set limits for providers."
            action={<button onClick={openNew} className="btn-primary-navy px-6 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2"><Plus className="w-4 h-4" /> Add Plan</button>}
          />
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50/80 border-b border-gray-100">
                    <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Plan Name</th>
                    <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-center">Max Events</th>
                    <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-center">Max Cars</th>
                    <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-center">Max Hotels</th>
                    <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {plans.map((plan) => (
                    <tr key={plan.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="p-4">
                        <span className="font-bold text-[#0F2044]">{plan.name}</span>
                      </td>
                      <td className="p-4 text-center">
                        <span className="text-gray-600 font-medium">{plan.max_events}</span>
                      </td>
                      <td className="p-4 text-center">
                        <span className="text-gray-600 font-medium">{plan.max_cars}</span>
                      </td>
                      <td className="p-4 text-center">
                        <span className="text-gray-600 font-medium">{plan.max_hotels}</span>
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openEdit(plan)}
                            className="p-2 text-gray-400 hover:text-[#1A3C6E] hover:bg-blue-50 rounded-lg transition-colors"
                            title="Edit Plan"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(plan)}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Delete Plan"
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
          </div>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden scale-in">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#0F2044]">{editing ? "Edit Plan" : "Add Plan"}</h2>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="p-6">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Plan Name</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-[#0F2044] focus:outline-none focus:border-[#1A3C6E] bg-gray-50/50 focus:bg-white transition-colors"
                    placeholder="e.g. Starter, Pro, Enterprise"
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Max Events</label>
                  <input
                    type="number"
                    value={form.max_events}
                    onChange={(e) => setForm({ ...form, max_events: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-[#0F2044] focus:outline-none focus:border-[#1A3C6E] bg-gray-50/50 focus:bg-white transition-colors"
                    placeholder="e.g. 10"
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Max Cars</label>
                  <input
                    type="number"
                    value={form.max_cars}
                    onChange={(e) => setForm({ ...form, max_cars: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-[#0F2044] focus:outline-none focus:border-[#1A3C6E] bg-gray-50/50 focus:bg-white transition-colors"
                    placeholder="e.g. 500"
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Max Hotels</label>
                  <input
                    type="number"
                    value={form.max_hotels}
                    onChange={(e) => setForm({ ...form, max_hotels: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-[#0F2044] focus:outline-none focus:border-[#1A3C6E] bg-gray-50/50 focus:bg-white transition-colors"
                    placeholder="e.g. 2"
                    disabled={saving}
                  />
                </div>
                <div className="pt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="flex-1 bg-gray-100 text-gray-600 font-semibold rounded-xl py-3 hover:bg-gray-200 transition-colors"
                    disabled={saving}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 btn-primary-navy rounded-xl py-3 font-semibold"
                    disabled={saving}
                  >
                    {saving ? "Saving..." : editing ? "Save Changes" : "Create Plan"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </SuperLayout>
  );
}
