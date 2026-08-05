import { Link } from "react-router-dom";
import { Car, ShieldCheck, Sparkles } from "lucide-react";

export default function Landing() {
  return (
    <div className="min-h-screen bg-[#F9FAFB] flex flex-col">
      <header className="bg-[#0F2044] text-white">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Car className="w-6 h-6" />
            <span className="font-heading text-xl font-bold tracking-tight">INSTAPARK</span>
          </div>
          <Link to="/superadmin/login" data-testid="nav-superadmin-login"
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-sm font-medium transition">
            Superadmin Login
          </Link>
        </div>
      </header>
      <main className="flex-1 max-w-5xl mx-auto px-6 py-16 text-center fade-in-up">
        <div className="inline-flex items-center gap-2 bg-[#1A3C6E]/5 text-[#1A3C6E] px-3 py-1 rounded-full text-xs font-semibold mb-6">
          <Sparkles className="w-3.5 h-3.5" /> Professional Valet Parking Management
        </div>
        <h1 className="font-heading text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-[#0F2044]">
          Move every car. Track every guest.
        </h1>
        <p className="mt-5 text-lg text-gray-600 max-w-2xl mx-auto">
          InstaPark gives valet operators a beautiful real-time dashboard, while guests scan a QR code and
          retrieve their car with a single tap.
        </p>
        <div className="mt-10 grid sm:grid-cols-3 gap-5 text-left">
          {[
            { icon: <Car className="w-5 h-5" />, t: "Real-time Tracking", d: "Live updates via WebSockets for every car and slot." },
            { icon: <ShieldCheck className="w-5 h-5" />, t: "Multi-Tenant", d: "Manage multiple providers, drivers, and events safely." },
            { icon: <Sparkles className="w-5 h-5" />, t: "Guest QR Page", d: "Scan, request, and rate — frictionless retrieval flow." },
          ].map((f, i) => (
            <div key={i} className="bg-white rounded-2xl shadow-card p-6 border border-gray-100">
              <div className="w-10 h-10 rounded-xl bg-[#1A3C6E]/10 text-[#1A3C6E] flex items-center justify-center mb-3">
                {f.icon}
              </div>
              <div className="font-heading font-semibold text-base">{f.t}</div>
              <div className="text-sm text-gray-500 mt-1">{f.d}</div>
            </div>
          ))}
        </div>
        <div className="mt-12">
          <Link to="/superadmin/login" data-testid="cta-superadmin"
            className="inline-block btn-primary-navy rounded-xl px-7 py-3 font-medium">
            Open Superadmin Dashboard →
          </Link>
        </div>
      </main>
    </div>
  );
}
