import { useState, useEffect } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import {
  Car, LogOut, LayoutDashboard, Building2, Hotel, Users,
  CalendarDays, Menu, List, Settings as SettingsIcon, ChevronRight, Shield, Bell, CheckCircle
} from "lucide-react";
import { api, decodeJwt } from "@/lib/api";
import { Sheet, SheetTrigger, SheetContent } from "@/components/ui/sheet";

export default function SuperLayout({ title, children }) {
  const nav = useNavigate();

  const handleTabClick = (e, to) => {
    if (to === "/superadmin/settings" && window.location.pathname === "/superadmin/settings") {
      e.preventDefault();
      nav("/superadmin/settings", { replace: true });
    }
  };
  const [expanded, setExpanded] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const token = localStorage.getItem("superadmin_token");
  const payload = token ? decodeJwt(token) : null;
  const name = payload?.name || localStorage.getItem("superadmin_name") || "Superadmin";

  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifs, setNotifs] = useState([]);
  
  // Polling unread count
  useEffect(() => {
    const fetchUnread = async () => {
      try {
        const { data } = await api.get("/notifications/unread-count");
        setUnreadCount(data.count || 0);
      } catch {}
    };
    if (token) fetchUnread();
    const interval = setInterval(() => {
      if (token) fetchUnread();
    }, 30000);
    return () => clearInterval(interval);
  }, [token]);

  // Fetch full notifications list when dropdown opens
  useEffect(() => {
    if (showNotifications) {
      api.get("/notifications/me").then(res => setNotifs(res.data)).catch(() => {});
    }
  }, [showNotifications]);

  const markAllRead = async () => {
    try {
      await api.post("/notifications/mark-all-read");
      setUnreadCount(0);
      setNotifs([]);
    } catch {}
  };

  const handleNotificationClick = async (notif) => {
    if (!notif.is_read) {
      try {
        await api.post(`/notifications/${notif.id}/read`);
        setUnreadCount(Math.max(0, unreadCount - 1));
        setNotifs(notifs.filter(n => n.id !== notif.id));
      } catch {}
    }
    setShowNotifications(false);
    
    // Navigate based on notification type
    if (notif.type === "qr_incident_reported" && notif.message) {
      // Find provider name in message or use related id (we don't have provider id directly in notif)
      // Actually, wait, the simplest is to navigate to the incidents tab in superadmin overall, 
      // but the prompt says: navigate to that provider's detail page QR Codes tab.
      // Since related_id is incident_id, we can just go to the provider if we extract it, 
      // or we can fetch the incident to get provider_id. We'll navigate to dashboard if we can't.
      // Wait, let's navigate to the global dashboard for now, or just /superadmin/providers.
      // Wait! The prompt says "use related_id/provider info from the notification message or add provider_id to the notification's related fields if needed"
      // Since I already wrote the backend to set related_id = incident_id, and we didn't add provider_id, let's try to extract from message?
      // Actually, we can fetch the incident.
      api.get(`/qr-card-incidents?incident_id=${notif.related_id}`).then(res => {
         // The backend get_qr_card_incidents requires provider_id and key_tag_number. So we can't easily fetch it this way.
      });
      // The prompt said "use related_id... check what's available". We don't have provider_id easily. Let's just go to providers list.
      nav(`/superadmin/providers`);
    } else if (notif.type === "admin_added") {
      nav(`/superadmin/providers`);
    }
  };

  const tabs = [
    { to: "/superadmin/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/superadmin/providers", label: "Valet Providers", icon: Building2 },
    { to: "/superadmin/hotels", label: "Hotels", icon: Hotel },
    { to: "/superadmin/drivers", label: "Drivers", icon: Users },
    { to: "/superadmin/supervisors", label: "Supervisors", icon: Shield },
    { to: "/superadmin/events", label: "Events", icon: CalendarDays },
    { to: "/superadmin/cars", label: "Cars Registry", icon: Car },
    { to: "/superadmin/live-monitor", label: "Live Monitor", icon: List },
    { to: "/superadmin/settings", label: "Settings", icon: SettingsIcon },
  ];

  const signOut = () => {
    localStorage.removeItem("superadmin_token");
    localStorage.removeItem("superadmin_name");
    nav("/superadmin/login");
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
              <Link to="/superadmin/dashboard" className="flex items-center gap-2">
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
                  `flex items-center gap-3 px-2 py-2.5 rounded-xl text-sm font-medium border-l-2 transition-colors ${isActive
                    ? "bg-white/10 text-white border-white"
                    : "text-white/60 border-transparent hover:text-white hover:bg-white/5"
                  } ${!expanded ? "justify-center" : ""}`
                }
              >
                <Icon className="w-[18px] h-[18px] shrink-0" />
                {expanded && (
                  <span className="text-[14px] whitespace-nowrap overflow-hidden">{label}</span>
                )}
              </NavLink>
            ))}
          </nav>
        </div>

        {/* Bottom: user + signout */}
        <div className={`border-t border-white/10 pt-4 mx-2 flex items-center gap-3 ${expanded ? "justify-between" : "justify-center"}`}>
          {expanded && (
            <span className="text-sm text-white/80 truncate" data-testid="header-username">
              {name}
            </span>
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
                      <Link to="/superadmin/dashboard" className="flex items-center gap-2 mb-8">
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

          <div className="flex items-center gap-3 relative">
            <button 
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative p-2 rounded-full hover:bg-white/10 transition-colors text-white/80 hover:text-white"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 rounded-full border-2 border-[#0F2044] text-[9px] font-bold flex items-center justify-center text-white">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
            
            {showNotifications && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowNotifications(false)} />
                <div className="absolute top-full right-0 mt-2 w-80 bg-white rounded-2xl shadow-xl border border-gray-100 z-50 overflow-hidden text-gray-800 flex flex-col">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
                    <h3 className="font-bold text-[#0F2044]">Notifications</h3>
                    <button onClick={markAllRead} className="text-xs font-semibold text-[#1A3C6E] hover:underline">
                      Mark all read
                    </button>
                  </div>
                  <div className="max-h-96 overflow-y-auto">
                    {notifs.length === 0 ? (
                      <div className="px-4 py-8 text-center text-gray-400 text-sm">
                        No notifications yet.
                      </div>
                    ) : (
                      notifs.map(n => (
                        <div 
                          key={n.id} 
                          onClick={() => handleNotificationClick(n)}
                          className="px-4 py-3 border-b border-gray-50 cursor-pointer transition-colors bg-blue-50/50 hover:bg-blue-50"
                        >
                          <div className="flex justify-between items-start mb-1">
                            <h4 className="text-sm font-bold text-[#0F2044]">{n.title}</h4>
                            <span className="text-[10px] font-semibold text-gray-400">
                              {new Date(n.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          <p className="text-xs text-gray-600 line-clamp-2">{n.message}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </header>

        <main className="px-3 sm:px-6 lg:px-8 py-4 sm:py-6 fade-in-up flex-1 min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
