import { useState } from "react";
import SuperLayout from "@/components/layout/SuperLayout";
import { api } from "@/lib/api";
import { toast } from "sonner";

export default function Settings() {
  const [triggeringJob, setTriggeringJob] = useState(false);

  const handleTriggerAllHotels = async () => {
    if (!window.confirm("This will run the daily event job for ALL hotels across ALL providers. Continue?")) return;
    setTriggeringJob(true);
    try {
      await api.post("/superadmin/trigger-daily-events");
      toast.success("Successfully processed daily event job for all hotels");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to run daily event job");
    } finally {
      setTriggeringJob(false);
    }
  };

  return (
    <SuperLayout title="Settings">
      <div className="p-6 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-[#0F2044] mb-6">Settings</h1>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-bold text-[#0F2044] mb-2">System Jobs</h2>
          <p className="text-sm text-gray-500 mb-6">
            Manually run the nightly daily-event job for every hotel across every provider. Use this if the scheduled midnight job failed to run — it's safe to run multiple times.
          </p>
          <button
            onClick={handleTriggerAllHotels}
            disabled={triggeringJob}
            className="px-4 py-2 bg-[#0F2044] text-white text-sm font-bold rounded-xl hover:bg-[#1a3660] transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {triggeringJob ? "Running..." : "Run Daily Event Job — All Hotels"}
          </button>
        </div>
      </div>
    </SuperLayout>
  );
}
