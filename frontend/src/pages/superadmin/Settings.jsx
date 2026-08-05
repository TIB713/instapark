import SuperLayout from "@/components/layout/SuperLayout";

export default function Settings() {
  return (
    <SuperLayout title="Settings">
      <div className="p-6 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-[#0F2044] mb-6">Settings</h1>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
          <p className="text-sm text-gray-400">
            Feature settings will appear here soon — control which features (like driver tracking) are enabled for each provider.
          </p>
        </div>
      </div>
    </SuperLayout>
  );
}
