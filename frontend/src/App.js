import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ErrorBoundary from "@/components/ErrorBoundary";
import { Toaster } from "@/components/ui/sonner";
import SuperLogin from "@/pages/superadmin/Login";
import SuperDashboard from "@/pages/superadmin/Dashboard";
import Providers from "@/pages/superadmin/Providers";
import ProviderDetail from "@/pages/superadmin/ProviderDetail";
import Hotels from "@/pages/superadmin/Hotels";
import HotelDetail from "@/pages/superadmin/HotelDetail";
import ValetProviderHotelDetail from "@/pages/superadmin/ValetProviderHotelDetail";
import Drivers from "@/pages/superadmin/Drivers";
import Supervisors from "@/pages/superadmin/Supervisors";
import SupervisorDetail from "@/pages/superadmin/SupervisorDetail";
import Events from "@/pages/superadmin/Events";
import EventDetail from "@/pages/superadmin/EventDetail";
import DriverDetail from "@/pages/superadmin/DriverDetail";
import Cars from "@/pages/superadmin/Cars";
import CarDetail from "@/pages/superadmin/CarDetail";
import LiveMonitor from "@/pages/superadmin/LiveMonitor";
import Settings from "@/pages/superadmin/Settings";
import GuestView from "@/pages/guest/GuestView";
import PreRegister from "@/pages/guest/PreRegister";
import EventPreRegister from "@/pages/guest/EventPreRegister";
import HotelPreRegister from "@/pages/guest/HotelPreRegister";
import PassView from "@/pages/guest/PassView";
import Landing from "@/pages/Landing";
import HostPortal from "@/pages/guest/HostPortal";

// Owner Portal Imports
import OwnerLogin from "@/pages/owner/Login";
import OwnerDashboard from "@/pages/owner/Dashboard";
import OwnerHotels from "@/pages/owner/Hotels";
import OwnerHotelDetail from "@/pages/owner/HotelDetail";
import OwnerEvents from "@/pages/owner/Events";
import OwnerEventDetail from "@/pages/owner/EventDetail";
import OwnerCars from "@/pages/owner/Cars";
import OwnerCarDetail from "@/pages/owner/CarDetail";
import OwnerIncidents from "@/pages/owner/Incidents";
import OwnerTeam from "@/pages/owner/Team";
import OwnerAdmins from "@/pages/owner/Admins";
import OwnerQrCodes from "@/pages/owner/QrCodes";

function isTokenValid(token) {
  try {
    const payload = JSON.parse(
      atob(token.split(".")[1])
    );
    return payload.exp && payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

function RequireAuth({ children }) {
  const t = localStorage.getItem("superadmin_token");
  if (!t || !isTokenValid(t)) {
    localStorage.removeItem("superadmin_token");
    localStorage.removeItem("superadmin_name");
    return <Navigate to="/superadmin/login" replace />;
  }
  return children;
}

function RequireOwnerAuth({ children }) {
  const t = localStorage.getItem("owner_token");
  if (!t || !isTokenValid(t)) {
    localStorage.removeItem("owner_token");
    localStorage.removeItem("owner_name");
    return <Navigate to="/provider/login" replace />;
  }
  return children;
}

function App() {
  return (
    <>
      <BrowserRouter>
        <ErrorBoundary><Routes>
          <Route path="/" element={<Landing />} />

          {/* Owner Portal Routes */}
          <Route path="/provider/login" element={<OwnerLogin />} />
          <Route path="/provider/dashboard" element={<RequireOwnerAuth><OwnerDashboard /></RequireOwnerAuth>} />
          <Route path="/provider/hotels" element={<RequireOwnerAuth><OwnerHotels /></RequireOwnerAuth>} />
          <Route path="/provider/hotels/:hid" element={<RequireOwnerAuth><OwnerHotelDetail /></RequireOwnerAuth>} />
          <Route path="/provider/events" element={<RequireOwnerAuth><OwnerEvents /></RequireOwnerAuth>} />
          <Route path="/provider/events/:eid" element={<RequireOwnerAuth><OwnerEventDetail /></RequireOwnerAuth>} />
          <Route path="/provider/cars" element={<RequireOwnerAuth><OwnerCars /></RequireOwnerAuth>} />
          <Route path="/provider/cars/:plate" element={<RequireOwnerAuth><OwnerCarDetail /></RequireOwnerAuth>} />
          <Route path="/provider/qr-codes" element={<RequireOwnerAuth><OwnerQrCodes /></RequireOwnerAuth>} />
          <Route path="/provider/incidents" element={<RequireOwnerAuth><OwnerIncidents /></RequireOwnerAuth>} />
          <Route path="/provider/team" element={<RequireOwnerAuth><OwnerTeam /></RequireOwnerAuth>} />
          <Route path="/provider/admins" element={<RequireOwnerAuth><OwnerAdmins /></RequireOwnerAuth>} />
          <Route path="/provider" element={<Navigate to="/provider/dashboard" replace />} />

          {/* Superadmin Routes */}
          <Route path="/superadmin/login" element={<SuperLogin />} />
          <Route path="/superadmin/dashboard" element={<RequireAuth><SuperDashboard /></RequireAuth>} />
          <Route path="/superadmin/providers" element={<RequireAuth><Providers /></RequireAuth>} />
          <Route path="/superadmin/providers/:id" element={<RequireAuth><ProviderDetail /></RequireAuth>} />
          <Route path="/superadmin/hotels" element={<RequireAuth><Hotels /></RequireAuth>} />
          <Route path="/superadmin/hotels/:hid" element={<RequireAuth><HotelDetail /></RequireAuth>} />
          <Route path="/superadmin/valet-provider-hotels/:hid" element={<RequireAuth><ValetProviderHotelDetail /></RequireAuth>} />
          <Route path="/superadmin/drivers" element={<RequireAuth><Drivers /></RequireAuth>} />
          <Route path="/superadmin/supervisors" element={<RequireAuth><Supervisors /></RequireAuth>} />
          <Route path="/superadmin/supervisors/:sid" element={<RequireAuth><SupervisorDetail /></RequireAuth>} />
          <Route path="/superadmin/drivers/:did" element={<RequireAuth><DriverDetail /></RequireAuth>} />
          <Route path="/superadmin/events" element={<RequireAuth><Events /></RequireAuth>} />
          <Route path="/superadmin/events/:eid" element={<RequireAuth><EventDetail /></RequireAuth>} />
          <Route path="/superadmin/cars" element={<RequireAuth><Cars /></RequireAuth>} />
          <Route path="/superadmin/cars/:plate" element={<RequireAuth><CarDetail /></RequireAuth>} />
          <Route path="/superadmin/live-monitor" element={<RequireAuth><LiveMonitor /></RequireAuth>} />
          <Route path="/superadmin/settings" element={<RequireAuth><Settings /></RequireAuth>} />
          <Route path="/superadmin" element={<Navigate to="/superadmin/dashboard" replace />} />

          {/* Guest and Verify Routes */}
          <Route path="/v/:token" element={<GuestView />} />
          <Route path="/r/:token" element={<GuestView />} />
          <Route path="/pre-register/:providerToken" element={<PreRegister />} />
          <Route path="/pre-register/event/:eventToken" element={<EventPreRegister />} />
          <Route path="/hotel-register/:hotelToken" element={<HotelPreRegister />} />
          <Route path="/pass/:passToken" element={<PassView />} />
          <Route path="/host-portal/:hostToken" element={<HostPortal />} />
        </Routes></ErrorBoundary>
      </BrowserRouter>
      <Toaster richColors position="top-center" />
    </>
  );
}

export default App;
