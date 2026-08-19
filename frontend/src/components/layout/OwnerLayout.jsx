import { useState, useEffect } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import {
  Car, LogOut, LayoutDashboard, Hotel, Users,
  CalendarDays, Menu, ChevronRight, Shield, ShieldCheck, Bell
} from "lucide-react";
import { api, decodeJwt } from "@/lib/api";
import { Sheet, SheetTrigger, SheetContent } from "@/components/ui/sheet";

export default function OwnerLayout({ title, children }) {
  const nav = useNavigate();

  const handleTabClick = (e, to) => {
    // Prevent default if clicking active link on some paths (placeholder logic)
  };
  const [expanded, setExpanded] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const token = localStorage.getItem("owner_token");
  const payload = token ? decodeJwt(token) : null;
  const name = payload?.name || localStorage.getItem("owner_name") || "Owner";
  const providerType = payload?.provider_type || localStorage.getItem("owner_provider_type") || "valet_provider";

  const [unreadCount, setUnreadCount] = useState(0);

  // Poll for unread count
  useEffect(() => {
    const fetchCount = async () => {
      try {
        const { data } = await api.get("/notifications/unread-count");
        setUnreadCount(data.count || 0);
      } catch (err) {
        // fail silently for polling
      }
    };

    // Initial fetch if token exists
    if (token) fetchCount();

    // Poll every 30s
    const interval = setInterval(() => {
      if (token) fetchCount();
    }, 30000);

    return () => clearInterval(interval);
  }, [token]);

  const allTabs = [
    { to: "/provider/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/provider/hotels", label: "Hotels", icon: Hotel, showFor: "valet_provider" },
    { to: "/provider/events", label: "Events", icon: CalendarDays },
    { to: "/provider/cars", label: "Cars", icon: Car },

    { to: "/provider/incidents", label: "Incidents", icon: Shield },
    { to: "/provider/team", label: "Team", icon: Users },
    { to: "/provider/admins", label: "Admins", icon: ShieldCheck },
  ];

  // Filter tabs conditionally
  const tabs = allTabs.filter(tab => !tab.showFor || tab.showFor === providerType);

  const signOut = () => {
    localStorage.removeItem("owner_token");
    localStorage.removeItem("owner_name");
    localStorage.removeItem("owner_provider_type");
    nav("/provider/login");
  };

  const sidebarWidth = expanded ? "w-[240px]" : "w-[64px]";

  return (
    <div className="min-h-screen bg-[#F9FAFB] flex">

      {/* ── DESKTOP SIDEBAR ── */}
      <aside
        className={`hidden md:flex fixed inset-y-0 left-0 ${sidebarWidth} bg-[#0F2044] text-white flex-col justify-between py-4 transition-all duration-300 ease-in-out overflow-hidden z-40`}
      >
        {/* Top: logo + toggle */}
        <div>
          <div className={`flex items-center px-3 mb-6 ${expanded ? "justify-between" : "justify-center"}`}>
            {expanded && (
              <Link to="/provider/dashboard" className="flex items-center gap-2">
                <Car className="w-5 h-5 shrink-0" />
                <span className="font-heading text-base font-extrabold tracking-tight whitespace-nowrap">INSTAPARK</span>
              </Link>
            )}
            <button
              onClick={() => setExpanded(e => !e)}
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 transition shrink-0"
            >
              {expanded
                ? <ChevronRight className="w-4 h-4 rotate-180 transition-transform duration-300" />
                : <Menu className="w-4 h-4" />
              }
            </button>
          </div>

          {/* Nav links */}
          <nav className="space-y-1 px-2">
            {tabs.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={(e) => handleTabClick(e, to)}
                title={!expanded ? label : undefined}
                className={({ isActive }) =>
                  `relative flex items-center gap-3 px-2 py-2.5 rounded-xl text-sm font-medium transition-colors overflow-hidden ${isActive
                    ? "bg-ownerGoldTint/10 text-white"
                    : "text-white/60 hover:text-white hover:bg-white/5"
                  } ${!expanded ? "justify-center" : ""}`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-4 bg-ownerGold rounded-r-md shadow-[0_0_8px_rgba(184,135,61,0.4)]" />
                    )}
                    <Icon className="w-[18px] h-[18px] shrink-0" />
                    {expanded && (
                      <span className="text-[14px] whitespace-nowrap overflow-hidden">{label}</span>
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        </div>

        {/* Bottom: user + signout */}
        <div className={`border-t border-white/10 pt-4 mx-2 flex items-center gap-3 ${expanded ? "justify-between" : "justify-center"}`}>
          {expanded && (
            <div className="flex flex-col min-w-0">
              <span className="text-sm text-white/80 truncate font-semibold" data-testid="header-username">
                {name}
              </span>
              <span className="text-xs text-ownerGold/80 truncate">
                {providerType === "hotel_owner" ? "Hotel Owner" : "Valet Provider"}
              </span>
            </div>
          )}
          <button
            onClick={signOut}
            data-testid="signout-btn"
            title={!expanded ? "Sign out" : undefined}
            className="flex items-center gap-1.5 text-xs bg-white/10 hover:bg-white/20 px-2 py-1.5 rounded-lg transition whitespace-nowrap"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {expanded && "Sign out"}
          </button>
        </div>
      </aside>

      {/* ── MAIN CONTENT ── */}
      <div className={`flex-1 flex flex-col min-h-screen min-w-0 transition-all duration-300 ${expanded ? "md:ml-[240px]" : "md:ml-[64px]"}`}>

        {/* Top header bar */}
        <header className="bg-[#0F2044] text-white h-12 flex items-center justify-between px-4 sm:px-6 shrink-0">
          <div className="flex items-center gap-3">

            {/* Mobile hamburger (Sheet) */}
            <div className="md:hidden">
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded-md border border-white/10 bg-white/5 px-2 py-1 text-white hover:bg-white/10"
                  >
                    <Menu className="w-5 h-5" />
                  </button>
                </SheetTrigger>
                <SheetContent side="left" className="p-0 w-[240px] bg-[#0F2044] text-white">
                  <div className="flex flex-col h-full px-4 py-6">
                    <div>
                      <Link to="/provider/dashboard" className="flex items-center gap-2 mb-8">
                        <Car className="w-6 h-6" />
                        <span className="font-heading text-lg font-extrabold tracking-tight">INSTAPARK</span>
                      </Link>
                      <nav className="space-y-1 mt-2">
                        {tabs.map(({ to, label, icon: Icon }) => (
                          <NavLink
                            key={to}
                            to={to}
                            onClick={(e) => {
                              handleTabClick(e, to);
                              setMobileOpen(false);
                            }}
                            className={({ isActive }) =>
                              `flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium border-l-2 transition-colors ${isActive
                                ? "bg-white/10 text-white border-white"
                                : "text-white/60 border-transparent hover:text-white"
                              }`
                            }
                          >
                            <Icon className="w-[18px] h-[18px]" />
                            <span className="text-[14px]">{label}</span>
                          </NavLink>
                        ))}
                      </nav>
                    </div>
                    <div className="mt-auto border-t border-white/10 pt-4 flex items-center justify-between gap-3">
                      <span className="text-sm text-white/80 truncate" data-testid="header-username">{name}</span>
                      <button
                        onClick={signOut}
                        data-testid="signout-btn"
                        className="flex items-center gap-1.5 text-xs bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg transition"
                      >
                        <LogOut className="w-4 h-4" /> Sign out
                      </button>
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </div>

            <span className="font-heading text-xs sm:text-sm font-semibold tracking-wide uppercase text-white/80 truncate max-w-[160px] sm:max-w-none">
              {title}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button className="relative p-2 rounded-full hover:bg-white/10 transition-colors text-white/80 hover:text-white">
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-[#0F2044]"></span>
              )}
            </button>
          </div>
        </header>

        <main className="px-3 sm:px-6 lg:px-8 py-4 sm:py-6 fade-in-up flex-1 min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
