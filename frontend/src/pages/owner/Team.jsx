import { useEffect, useState, useMemo, useRef } from "react";
import OwnerLayout from "@/components/layout/OwnerLayout";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { Search, Users, Shield, User, Plus, X, Check, AlertTriangle, CheckCircle } from "lucide-react";
import SkeletonTable from "@/components/ui/SkeletonTable";
import EmptyState from "@/components/ui/EmptyState";
import StatusBadge from "@/components/ui/StatusBadge";

import { useScrollToFirstError } from "../../hooks/useScrollToFirstError";

export default function OwnerTeam() {
  const nav = useNavigate();
  const driverFieldRefs = useRef({});
  const scrollToFirstDriverError = useScrollToFirstError(["name", "phone", "pin", "email", "gender", "pan_number", "bank_account_number", "bank_ifsc", "driving_license_number", "aadhar_number", "licensePhoto", "drvAadharPhoto"], driverFieldRefs);

  const supervisorFieldRefs = useRef({});
  const scrollToFirstSupervisorError = useScrollToFirstError(["name", "phone", "email", "gender", "password", "confirmPassword", "pan_number", "bank_account_number", "bank_ifsc", "aadhar_number", "supAadharPhoto"], supervisorFieldRefs);
  const [activeTab, setActiveTab] = useState("drivers");
  const [drivers, setDrivers] = useState([]);
  const [supervisors, setSupervisors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");


  const [driverModal, setDriverModal] = useState(false);
  const [driverErrors, setDriverErrors] = useState({});
  const [driverForm, setDriverForm] = useState({
    name: "", phone: "", pin: "", email: "", gender: "",
    pan_number: "", bank_account_number: "",
    bank_ifsc: "", driving_license_number: "",
    aadhar_number: "", aadhar_photo: ""
  });
  const [savingDriver, setSavingDriver] = useState(false);

  const [supervisorModal, setSupervisorModal] = useState(false);
  const [supervisorErrors, setSupervisorErrors] = useState({});
  const [supervisorForm, setSupervisorForm] = useState({
    name: "", email: "", phone: "", password: "", confirmPassword: "", gender: "",
    pan_number: "", bank_account_number: "", bank_ifsc: "", supervisor_photo: "",
    aadhar_number: "", aadhar_photo: ""
  });
  const [savingSupervisor, setSavingSupervisor] = useState(false);

  // Driver upload states
  const [licensePhotoFile, setLicensePhotoFile] = useState(null);
  const [licensePhotoPreview, setLicensePhotoPreview] = useState(null);
  const [drvAadharPhotoFile, setDrvAadharPhotoFile] = useState(null);
  const [drvAadharPhotoPreview, setDrvAadharPhotoPreview] = useState(null);
  const [driverPhotoFile, setDriverPhotoFile] = useState(null);
  const [driverPhotoPreview, setDriverPhotoPreview] = useState(null);
  const [uploadingLicense, setUploadingLicense] = useState(false);
  const [uploadingDriverPhoto, setUploadingDriverPhoto] = useState(false);

  // Supervisor upload states
  const [supervisorPhotoFile, setSupervisorPhotoFile] = useState(null);
  const [supervisorPhotoPreview, setSupervisorPhotoPreview] = useState(null);
  const [supAadharPhotoFile, setSupAadharPhotoFile] = useState(null);
  const [supAadharPhotoPreview, setSupAadharPhotoPreview] = useState(null);



  const handleLicensePhoto = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLicensePhotoFile(file);
    setLicensePhotoPreview(URL.createObjectURL(file));
  };

  const handleDriverAadharPhoto = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setDrvAadharPhotoFile(file);
    setDrvAadharPhotoPreview(URL.createObjectURL(file));
  };

  const handleSupAadharPhoto = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setSupAadharPhotoFile(file);
    setSupAadharPhotoPreview(URL.createObjectURL(file));
  };

  const handleDriverPhoto = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setDriverPhotoFile(file);
    setDriverPhotoPreview(URL.createObjectURL(file));
  };


  const validateDriver = () => {
    const errs = {};
    if (!driverForm.name?.trim()) errs.name = "Name is required";
    if (!driverForm.phone?.trim()) errs.phone = "Phone is required";
    else if (!/^\d{10}$/.test(driverForm.phone.replace(/\D/g, ""))) errs.phone = "Phone must be exactly 10 digits";
    if (!driverForm.pin || driverForm.pin.length !== 4) errs.pin = "PIN must be exactly 4 digits";
    else if (!/^\d{4}$/.test(driverForm.pin)) errs.pin = "PIN must contain digits only";
    if (!driverForm.email?.trim()) errs.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(driverForm.email.trim())) errs.email = "Please enter a valid email address";
    if (!driverForm.gender) errs.gender = "Please select gender";
    if (driverForm.pan_number?.trim() && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(driverForm.pan_number.trim().toUpperCase())) errs.pan_number = "Invalid PAN format. Expected: ABCDE1234F";
    if (driverForm.bank_account_number?.trim() && !/^\d{9,18}$/.test(driverForm.bank_account_number.trim())) errs.bank_account_number = "Bank account number must be 9–18 digits";
    if (driverForm.bank_ifsc?.trim() && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(driverForm.bank_ifsc.trim().toUpperCase())) errs.bank_ifsc = "Invalid IFSC format. Expected: ABCD0123456";
    if (!driverForm.driving_license_number?.trim()) errs.driving_license_number = "Driving License Number is required";
    else if (!/^[A-Z0-9]{10,16}$/.test(driverForm.driving_license_number.trim().toUpperCase())) errs.driving_license_number = "Invalid driving license number. Must be 10–16 alphanumeric characters";
    if (!driverForm.aadhar_number?.trim()) errs.aadhar_number = "Aadhar Number is required";
    else if (!/^\d{12}$/.test(driverForm.aadhar_number.trim())) errs.aadhar_number = "Aadhar number must be exactly 12 digits";

    if (!licensePhotoFile && !licensePhotoPreview) errs.licensePhoto = "Driving License Photo is required";
    if (!drvAadharPhotoFile && !drvAadharPhotoPreview) errs.drvAadharPhoto = "Aadhar Photo is required";
    return errs;
  };

  const validateSupervisor = () => {
    const errs = {};
    if (!supervisorForm.name.trim()) errs.name = "Name is required";
    if (!supervisorForm.phone.trim() || supervisorForm.phone.length !== 10) errs.phone = "Valid 10-digit phone number required";
    if (!supervisorForm.email.trim() || !/^\S+@\S+\.\S+$/.test(supervisorForm.email)) errs.email = "Valid email is required";
    if (!supervisorForm.gender) errs.gender = "Gender is required";
    if (!supervisorForm.password) errs.password = "Password is required";
    if (supervisorForm.password !== supervisorForm.confirmPassword) errs.confirmPassword = "Passwords do not match";
    if (!supervisorForm.aadhar_number || supervisorForm.aadhar_number.length !== 12) errs.aadhar_number = "Valid 12-digit Aadhar number required";
    if (!supAadharPhotoFile) errs.supAadharPhoto = "Aadhar photo is required";
    
    // Optional fields validation
    if (supervisorForm.pan_number && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(supervisorForm.pan_number)) {
      errs.pan_number = "Invalid PAN format";
    }
    if (supervisorForm.bank_account_number && supervisorForm.bank_account_number.length < 9) {
      errs.bank_account_number = "Invalid bank account number";
    }
    if (supervisorForm.bank_ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(supervisorForm.bank_ifsc)) {
      errs.bank_ifsc = "Invalid IFSC format";
    }
    
    return errs;
  };

  const handleAddSupervisor = async (e) => {
    e.preventDefault();
    const errs = validateSupervisor();
    setSupervisorErrors(errs);
    if (Object.keys(errs).length > 0) {
      scrollToFirstSupervisorError(errs);
      return;
    }

    setSavingSupervisor(true);

    let aadharPhotoUrl = undefined;
    if (supAadharPhotoFile) {
      try {
        const fd = new FormData();
        fd.append("file", supAadharPhotoFile);
        fd.append("folder", "aadhar_photos");
        const up = await api.post("/upload", fd, {
          headers: { "Content-Type": "multipart/form-data" }
        });
        aadharPhotoUrl = up.data.url;
      } catch { toast.error("Aadhar photo upload failed, saving without it."); }
    }

    let supervisorPhotoUrl = undefined;
    if (supervisorPhotoFile) {
      try {
        const fd = new FormData();
        fd.append("file", supervisorPhotoFile);
        fd.append("folder", "supervisor_photos");
        const up = await api.post("/upload", fd, {
          headers: { "Content-Type": "multipart/form-data" }
        });
        supervisorPhotoUrl = up.data.url;
      } catch { toast.error("Supervisor photo upload failed, saving without it."); }
    }

    try {
      await api.post("/supervisors", {
        name: supervisorForm.name.trim(),
        phone: supervisorForm.phone.trim(),
        password: supervisorForm.password,
        email: supervisorForm.email.trim(),
        gender: supervisorForm.gender,
        pan_number: supervisorForm.pan_number.trim(),
        bank_account_number: supervisorForm.bank_account_number.trim(),
        bank_ifsc: supervisorForm.bank_ifsc.trim(),
        aadhar_number: supervisorForm.aadhar_number.trim(),
        aadhar_photo: aadharPhotoUrl,
        photo_url: supervisorPhotoUrl
      });
      toast.success("Supervisor added successfully!");
      setSupervisorModal(false);
      setSupervisorForm({
        name: "", email: "", phone: "", password: "", confirmPassword: "", gender: "",
        pan_number: "", bank_account_number: "", bank_ifsc: "", supervisor_photo: "",
        aadhar_number: "", aadhar_photo: ""
      });
      setSupervisorPhotoFile(null);
      setSupervisorPhotoPreview("");
      setSupAadharPhotoFile(null);
      setSupAadharPhotoPreview("");
      fetchAll();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to create supervisor");
    } finally {
      setSavingSupervisor(false);
    }
  };

  const handleAddDriver = async (e) => {
    e.preventDefault();
    const errs = validateDriver();
    setDriverErrors(errs);
    if (Object.keys(errs).length > 0) {
      scrollToFirstDriverError(errs);
      return;
    }

    setSavingDriver(true);

    let licensePhotoUrl = undefined;
    if (licensePhotoFile) {
      setUploadingLicense(true);
      try {
        const fd = new FormData();
        fd.append("file", licensePhotoFile);
        fd.append("folder", "driving_licenses");
        const up = await api.post("/upload", fd, {
          headers: { "Content-Type": "multipart/form-data" }
        });
        licensePhotoUrl = up.data.url;
      } catch { toast.error("License photo upload failed, saving without it."); }
      finally { setUploadingLicense(false); }
    }

    let aadharPhotoUrl = undefined;
    if (drvAadharPhotoFile) {
      try {
        const fd = new FormData();
        fd.append("file", drvAadharPhotoFile);
        fd.append("folder", "aadhar_photos");
        const up = await api.post("/upload", fd, {
          headers: { "Content-Type": "multipart/form-data" }
        });
        aadharPhotoUrl = up.data.url;
      } catch { toast.error("Aadhar photo upload failed, saving without it."); }
    }

    let driverPhotoUrl = undefined;
    if (driverPhotoFile) {
      setUploadingDriverPhoto(true);
      try {
        const fd = new FormData();
        fd.append("file", driverPhotoFile);
        fd.append("folder", "driver_photos");
        const up = await api.post("/upload", fd, {
          headers: { "Content-Type": "multipart/form-data" }
        });
        driverPhotoUrl = up.data.url;
      } catch { toast.error("Driver photo upload failed, saving without it."); }
      finally { setUploadingDriverPhoto(false); }
    }

    try {
      const { data } = await api.post("/drivers", {
        name: driverForm.name.trim(),
        phone: driverForm.phone.trim(),
        pin: driverForm.pin,

        email: driverForm.email.trim(),
        gender: driverForm.gender,
        pan_number: driverForm.pan_number.trim(),
        bank_account_number: driverForm.bank_account_number.trim(),
        bank_ifsc: driverForm.bank_ifsc.trim().toUpperCase(),
        driving_license_number: driverForm.driving_license_number.trim().toUpperCase(),
        driving_license_photo: licensePhotoUrl,
        aadhar_number: driverForm.aadhar_number.trim(),
        aadhar_photo: aadharPhotoUrl,
        driver_photo: driverPhotoUrl,
      });
      toast.success(`Driver created! Employee ID: ${data.employee_id} | PIN: ${data.pin}`);
      setDriverModal(false);
      load(); // reload provider data to refresh driver list 
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to create driver");
    } finally {
      setSavingDriver(false);
    }
  };




  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === "Escape") {
        setDriverModal(false);
        setSupervisorModal(false);
      }
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [dRes, sRes] = await Promise.all([
        api.get("/drivers"),
        api.get("/supervisors")
      ]);
      setDrivers(Array.isArray(dRes.data) ? dRes.data : []);
      setSupervisors(Array.isArray(sRes.data) ? sRes.data : []);
    } catch (err) {
      toast.error("Failed to load team data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleDownloadSample = async () => {
    try {
      const res = await api.get("/drivers/bulk-template", { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = "driver_bulk_template.xlsx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error("Failed to download sample template");
    }
  };

  const handleBulkUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      const { data } = await api.post("/drivers/bulk-upload", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      const warnedCount = (data.results || []).filter(r => r.status === "Added (with warnings)").length;
      let msg = `Inserted: ${data.inserted}`;
      if (warnedCount > 0) {
        msg += ` (${warnedCount} with warnings — check the downloaded file for details)`;
      }
      msg += `\nSkipped: ${data.skipped}`;
      toast.success(msg);

      let csv = "Row,Name,Phone,Status,Reason\n";
      (data.results || []).forEach(r => {
        csv += `${r.row},"${r.name || ""}","${r.phone || ""}",${r.status},"${r.reason || ""}"\n`;
      });
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bulk_upload_result_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      const dRes = await api.get("/drivers");
      setDrivers(Array.isArray(dRes.data) ? dRes.data : []);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Upload failed");
    }
    e.target.value = "";
  };

  const handleActivate = async (id) => {
    try {
      await api.patch(`/drivers/${id}/activate`);
      toast.success("Driver activated");
      const dRes = await api.get("/drivers");
      setDrivers(Array.isArray(dRes.data) ? dRes.data : []);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to activate");
    }
  };

  const filteredDrivers = useMemo(() => {
    return drivers.filter(d => !q || (d.name?.toLowerCase().includes(q.toLowerCase()) || d.phone?.includes(q)));
  }, [drivers, q]);

  const filteredSupervisors = useMemo(() => {
    return supervisors.filter(s => !q || (s.name?.toLowerCase().includes(q.toLowerCase()) || s.phone?.includes(q)));
  }, [supervisors, q]);

  return (
    <OwnerLayout title="Team">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold text-[#0F2044]">Team Management</h1>
        <p className="text-gray-500 text-sm">View your registered drivers and supervisors.</p>
      </div>

      <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden fade-in-up">
        <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex bg-white rounded-xl p-1 border border-gray-200">
            <button
              onClick={() => setActiveTab("drivers")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${activeTab === "drivers" ? "bg-[#0F2044] text-white shadow" : "text-gray-500 hover:text-gray-900 hover:bg-gray-50"}`}
            >
              <User className="w-4 h-4" /> Drivers ({drivers.length})
            </button>
            <button
              onClick={() => setActiveTab("supervisors")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${activeTab === "supervisors" ? "bg-[#0F2044] text-white shadow" : "text-gray-500 hover:text-gray-900 hover:bg-gray-50"}`}
            >
              <Shield className="w-4 h-4" /> Supervisors ({supervisors.length})
            </button>
          </div>

          <div className="flex gap-4 w-full sm:w-auto ml-auto items-center">

            {activeTab === "supervisors" && (
              <button onClick={() => setSupervisorModal(true)} className="text-sm px-3 py-2 bg-amber-500 text-white rounded-lg font-semibold hover:bg-amber-600 flex items-center whitespace-nowrap gap-1 mr-2">
                <Plus className="w-4 h-4" /> Add Supervisor
              </button>
            )}
            {activeTab === "drivers" && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDriverModal(true)}
                  className="text-sm px-3 py-2 bg-amber-500 text-white rounded-lg font-semibold hover:bg-amber-600 flex items-center whitespace-nowrap gap-1"
                >
                  <Plus className="w-4 h-4" /> Add Driver
                </button>
                <button
                  type="button"
                  onClick={handleDownloadSample}
                  className="text-sm px-3 py-2 border border-[#0F2044] text-[#0F2044] rounded-lg font-semibold hover:bg-gray-50 flex items-center whitespace-nowrap"
                >
                  Sample
                </button>
                <label className="text-sm px-3 py-2 bg-[#0F2044] text-white rounded-lg font-semibold hover:bg-[#0F2044]/90 cursor-pointer flex items-center whitespace-nowrap">
                  Bulk Add
                  <input type="file" className="hidden" accept=".xlsx" onChange={handleBulkUpload} />
                </label>
              </div>
            )}
            <div className="relative w-full max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder={`Search ${activeTab}...`}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-sm rounded-xl border border-gray-200 focus:border-[#1A3C6E] focus:ring-1 focus:ring-[#1A3C6E] outline-none"
              />
            </div>
          </div>
          {/* <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder={`Search ${activeTab}...`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm rounded-xl border border-gray-200 focus:border-[#1A3C6E] focus:ring-1 focus:ring-[#1A3C6E] outline-none"
          /> */}
        </div>
      </div>

      {loading ? (
        <SkeletonTable rows={5} columns={4} />
      ) : activeTab === "drivers" ? (
        filteredDrivers.length === 0 ? (
          <EmptyState theme="owner" icon={<Users className="w-8 h-8" />} title="No Drivers" description={q ? "No drivers match your search." : "No drivers found."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-[#0F2044]/[0.04] text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100">
                  <th className="px-6 py-4">Name</th>
                  <th className="px-6 py-4">Phone</th>
                  <th className="px-6 py-4">Assigned Hotel</th>
                  <th className="px-6 py-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredDrivers.map(d => (
                  <tr key={d.id} onClick={() => nav(`/provider/drivers/${d.id}`)} className="hover:bg-gray-50 transition-colors cursor-pointer">
                    <td className="px-6 py-4 font-semibold text-[#0F2044]">{d.name}</td>
                    <td className="px-6 py-4 text-gray-600">{d.phone || "—"}</td>
                    <td className="px-6 py-4 text-gray-600">{d.hotel_name || "—"}</td>
                    <td className="px-6 py-4 flex items-center gap-2">
                      <StatusBadge status={d.is_active !== false ? "active" : "inactive"} />
                      {
  d.is_verified ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
      <CheckCircle className="w-3 h-3" /> Verified
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium">
      <AlertTriangle className="w-3 h-3" /> Unverified
    </span>
  )
}
                      {!d.is_active && (
                        <button onClick={(e) => { e.stopPropagation(); handleActivate(d.id); }} className="ml-2 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded border text-blue-600 bg-blue-50 border-blue-200 hover:bg-blue-100">
                          Activate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        filteredSupervisors.length === 0 ? (
          <EmptyState theme="owner" icon={<Shield className="w-8 h-8" />} title="No Supervisors" description={q ? "No supervisors match your search." : "No supervisors found."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-[#0F2044]/[0.04] text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100">
                  <th className="px-6 py-4">Name</th>
                  <th className="px-6 py-4">Phone / Email</th>
                  <th className="px-6 py-4">Assigned Hotel</th>
                  <th className="px-6 py-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredSupervisors.map(s => (
                  <tr key={s.id} onClick={() => nav(`/provider/supervisors/${s.id}`)} className="hover:bg-gray-50 transition-colors cursor-pointer">
                    <td className="px-6 py-4 font-semibold text-[#0F2044]">{s.name}</td>
                    <td className="px-6 py-4 text-gray-600">
                      <div>{s.phone || "—"}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{s.email || "—"}</div>
                    </td>
                    <td className="px-6 py-4 text-gray-600">{s.hotel_name || "—"}</td>
                    <td className="px-6 py-4 flex items-center gap-2">
                      <StatusBadge status={s.is_active !== false ? "active" : "inactive"} />
                      {
  s.is_verified ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
      <CheckCircle className="w-3 h-3" /> Verified
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium">
      <AlertTriangle className="w-3 h-3" /> Unverified
    </span>
  )
}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {driverModal && (
        <div id="modal-add-driver" className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-8 bg-black/50 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl flex flex-col mb-8">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
              <h3 className="font-heading text-xl font-bold text-[#0F2044]">Add Driver</h3>
              <button onClick={() => setDriverModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="px-6 py-4">
              <form onSubmit={handleAddDriver} className="space-y-4">
                <div className="flex flex-col items-center mb-4">
                  <div className="relative group">
                    <div
                      onClick={() => document.getElementById("driver-photo-input").click()}
                      className="w-20 h-20 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-[#1A3C6E] transition overflow-hidden"
                    >
                      {driverPhotoPreview ? (
                        <img src={driverPhotoPreview} alt="Driver"
                          className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-3xl">🧑</span>
                      )}
                    </div>
                    {driverPhotoPreview && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDriverPhotoPreview(null);
                          setDriverPhotoFile(null);
                        }}
                        className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-400 hover:text-red-500 hover:border-red-200 transition-all z-10"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 mt-1">Driver Photo (optional)</span>
                  <input
                    id="driver-photo-input"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleDriverPhoto}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Name <span className="text-red-500">*</span></label>
                    <input ref={el => { if (driverFieldRefs.current) driverFieldRefs.current.name = el; }}  type="text" value={driverForm.name}
                      onChange={e => { setDriverForm({ ...driverForm, name: e.target.value }); if (driverErrors.name) setDriverErrors(prev => ({ ...prev, name: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${driverErrors.name ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`} />
                    {driverErrors.name && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.name}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Phone <span className="text-red-500">*</span></label>
                    <input ref={el => { if (driverFieldRefs.current) driverFieldRefs.current.phone = el; }}  type="tel" inputMode="numeric" value={driverForm.phone}
                      onChange={e => { setDriverForm({ ...driverForm, phone: e.target.value.replace(/\D/g, "").slice(0, 10) }); if (driverErrors.phone) setDriverErrors(prev => ({ ...prev, phone: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${driverErrors.phone ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`} />
                    {driverErrors.phone && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.phone}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">4-Digit PIN <span className="text-red-500">*</span></label>
                    <input ref={el => { if (driverFieldRefs.current) driverFieldRefs.current.pin = el; }}  type="text" value={driverForm.pin}
                      onChange={e => { setDriverForm({ ...driverForm, pin: e.target.value.replace(/\D/g, "").slice(0, 4) }); if (driverErrors.pin) setDriverErrors(prev => ({ ...prev, pin: undefined })); }}
                      placeholder="e.g. 1234"
                      className={`w-full px-4 py-2 rounded-xl border ${driverErrors.pin ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E] font-mono tracking-widest`} />
                    {driverErrors.pin && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.pin}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                      Email <span className="text-red-500">*</span>
                    </label>
                    <input ref={el => { if (driverFieldRefs.current) driverFieldRefs.current.email = el; }}  type="email" value={driverForm.email}
                      onChange={e => { setDriverForm({ ...driverForm, email: e.target.value }); if (driverErrors.email) setDriverErrors(prev => ({ ...prev, email: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${driverErrors.email ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`} />
                    {driverErrors.email && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.email}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Gender <span className="text-red-500">*</span></label>
                    <select ref={el => { if (driverFieldRefs.current) driverFieldRefs.current.gender = el; }}  value={driverForm.gender}
                      onChange={e => { setDriverForm({ ...driverForm, gender: e.target.value }); if (driverErrors.gender) setDriverErrors(prev => ({ ...prev, gender: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${driverErrors.gender ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`}>
                      <option value="" disabled>Select gender</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                    {driverErrors.gender && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.gender}</p>}
                  </div>
                </div>

                <div className="border-t border-gray-100 my-2" />
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">
                  Documents
                </p>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">PAN Card Number</label>
                    <input ref={el => { if (driverFieldRefs.current) driverFieldRefs.current.pan_number = el; }}  type="text" placeholder="ABCDE1234F" value={driverForm.pan_number}
                      onChange={e => { setDriverForm({ ...driverForm, pan_number: e.target.value.toUpperCase().slice(0, 10) }); if (driverErrors.pan_number) setDriverErrors(prev => ({ ...prev, pan_number: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${driverErrors.pan_number ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E] font-mono`} />
                    {driverErrors.pan_number && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.pan_number}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Bank Account Number</label>
                    <input ref={el => { if (driverFieldRefs.current) driverFieldRefs.current.bank_account_number = el; }}  type="text" inputMode="numeric" value={driverForm.bank_account_number}
                      onChange={e => { setDriverForm({ ...driverForm, bank_account_number: e.target.value.replace(/\D/g, "").slice(0, 18) }); if (driverErrors.bank_account_number) setDriverErrors(prev => ({ ...prev, bank_account_number: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${driverErrors.bank_account_number ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`} />
                    {driverErrors.bank_account_number && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.bank_account_number}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Bank IFSC Code</label>
                    <input ref={el => { if (driverFieldRefs.current) driverFieldRefs.current.bank_ifsc = el; }}  type="text" placeholder="SBIN0001234" value={driverForm.bank_ifsc}
                      onChange={e => { setDriverForm({ ...driverForm, bank_ifsc: e.target.value.toUpperCase().slice(0, 11) }); if (driverErrors.bank_ifsc) setDriverErrors(prev => ({ ...prev, bank_ifsc: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${driverErrors.bank_ifsc ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E] font-mono`} />
                    {driverErrors.bank_ifsc && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.bank_ifsc}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Driving License Number <span className="text-red-500">*</span></label>
                    <input ref={el => { if (driverFieldRefs.current) driverFieldRefs.current.driving_license_number = el; }}  type="text" inputMode="text" value={driverForm.driving_license_number}
                      onChange={e => { setDriverForm({ ...driverForm, driving_license_number: e.target.value.toUpperCase().slice(0, 16) }); if (driverErrors.driving_license_number) setDriverErrors(prev => ({ ...prev, driving_license_number: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${driverErrors.driving_license_number ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E] font-mono`} />
                    {driverErrors.driving_license_number && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.driving_license_number}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Aadhar Number <span className="text-red-500">*</span></label>
                    <input ref={el => { if (driverFieldRefs.current) driverFieldRefs.current.aadhar_number = el; }}  type="text" inputMode="numeric" value={driverForm.aadhar_number}
                      onChange={e => { setDriverForm({ ...driverForm, aadhar_number: e.target.value.replace(/\D/g, "").slice(0, 12) }); if (driverErrors.aadhar_number) setDriverErrors(prev => ({ ...prev, aadhar_number: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${driverErrors.aadhar_number ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`} />
                    {driverErrors.aadhar_number && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.aadhar_number}</p>}
                  </div>
                  <div />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                    Driving License Photo <span className="text-red-500">*</span>
                  </label>
                  <div ref={el => { if (driverFieldRefs.current) driverFieldRefs.current.licensePhoto = el; }}  className="relative group">
                    <div
                      onClick={() => document.getElementById("license-photo-input").click()}
                      className={`w-full border-2 border-dashed ${driverErrors.licensePhoto ? "border-red-400" : "border-gray-200"} rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer hover:border-[#1A3C6E] transition`}
                    >
                      {licensePhotoPreview ? (
                        <img src={licensePhotoPreview} alt="License"
                          className="h-24 w-full object-cover rounded-lg" />
                      ) : (
                        <>
                          <span className="text-2xl mb-1">💳</span>
                          <span className="text-xs text-gray-400">Click to upload license photo</span>
                        </>
                      )}
                    </div>
                    {licensePhotoPreview && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLicensePhotoPreview(null);
                          setLicensePhotoFile(null);
                        }}
                        className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-400 hover:text-red-500 hover:border-red-200 transition-all z-10"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <input
                    id="license-photo-input"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleLicensePhoto}
                  />
                </div>
                {driverErrors.licensePhoto && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.licensePhoto}</p>}

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                    Aadhar Photo <span className="text-red-500">*</span>
                  </label>
                  <div ref={el => { if (driverFieldRefs.current) driverFieldRefs.current.drvAadharPhoto = el; }}  className="relative group">
                    <div
                      onClick={() => document.getElementById("drv-aadhar-photo-input").click()}
                      className={`w-full border-2 border-dashed ${driverErrors.drvAadharPhoto ? "border-red-400" : "border-gray-200"} rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer hover:border-[#1A3C6E] transition`}
                    >
                      {drvAadharPhotoPreview ? (
                        <img src={drvAadharPhotoPreview} alt="Aadhar"
                          className="h-24 w-full object-cover rounded-lg" />
                      ) : (
                        <>
                          <span className="text-2xl mb-1">📄</span>
                          <span className="text-xs text-gray-400">Click to upload aadhar photo</span>
                        </>
                      )}
                    </div>
                    {drvAadharPhotoPreview && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDrvAadharPhotoPreview(null);
                          setDrvAadharPhotoFile(null);
                        }}
                        className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-400 hover:text-red-500 hover:border-red-200 transition-all z-10"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <input
                    id="drv-aadhar-photo-input"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => { handleDriverAadharPhoto(e); if (driverErrors.drvAadharPhoto) setDriverErrors(prev => ({ ...prev, drvAadharPhoto: undefined })); }}
                  />
                </div>
                {driverErrors.drvAadharPhoto && <p className="text-[11px] text-red-500 mt-1 font-medium">* {driverErrors.drvAadharPhoto}</p>}


                <p className="text-xs text-gray-400 mb-2"><span className="text-red-500">*</span> Required fields</p>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setDriverModal(false)}
                    className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50">Cancel</button>
                  <button type="submit" disabled={savingDriver}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-[#1A3C6E] text-white font-semibold hover:bg-[#0F2044] disabled:opacity-60">
                    {savingDriver ? "Saving..." : "Add Driver"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
      {supervisorModal && (
        <div id="modal-add-supervisor" className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-8 bg-black/50 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl flex flex-col animate-in fade-in zoom-in duration-200 mb-8">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
              <h3 className="font-heading text-xl font-bold text-[#0F2044]">Add Supervisor</h3>
              <button onClick={() => setSupervisorModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="px-6 py-4">
              <form onSubmit={handleAddSupervisor} autoComplete="off" className="space-y-4">
                <div className="flex flex-col items-center mb-4">
                  <div className="relative group">
                    <div
                      onClick={() => document.getElementById("supervisor-photo-input").click()}
                      className="w-20 h-20 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-[#1A3C6E] transition overflow-hidden"
                    >
                      {supervisorPhotoPreview ? (
                        <img src={supervisorPhotoPreview} alt="Supervisor"
                          className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-3xl">🧑‍💼</span>
                      )}
                    </div>
                    {supervisorPhotoPreview && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSupervisorPhotoPreview(null);
                          setSupervisorForm(prev => ({ ...prev, supervisor_photo_file: null }));
                        }}
                        className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-400 hover:text-red-500 hover:border-red-200 transition-all z-10"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 mt-1">Supervisor Photo (optional)</span>
                  <input
                    id="supervisor-photo-input"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files[0];
                      if (!file) return;
                      setSupervisorPhotoPreview(URL.createObjectURL(file));
                      setSupervisorForm(prev => ({ ...prev, supervisor_photo_file: file }));
                    }}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Full Name <span className="text-red-500">*</span></label>
                    <input ref={el => { if (supervisorFieldRefs.current) supervisorFieldRefs.current.name = el; }}  type="text" value={supervisorForm.name}
                      onChange={e => { setSupervisorForm({ ...supervisorForm, name: e.target.value }); if (supervisorErrors.name) setSupervisorErrors(prev => ({ ...prev, name: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${supervisorErrors.name ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`} />
                    {supervisorErrors.name && <p className="text-[11px] text-red-500 mt-1 font-medium">* {supervisorErrors.name}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Phone Number <span className="text-red-500">*</span></label>
                    <input ref={el => { if (supervisorFieldRefs.current) supervisorFieldRefs.current.phone = el; }}  type="tel" inputMode="numeric" value={supervisorForm.phone}
                      onChange={e => { setSupervisorForm({ ...supervisorForm, phone: e.target.value.replace(/\D/g, "").slice(0, 10) }); if (supervisorErrors.phone) setSupervisorErrors(prev => ({ ...prev, phone: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${supervisorErrors.phone ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`} />
                    {supervisorErrors.phone && <p className="text-[11px] text-red-500 mt-1 font-medium">* {supervisorErrors.phone}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Email <span className="text-red-500">*</span></label>
                    <input ref={el => { if (supervisorFieldRefs.current) supervisorFieldRefs.current.email = el; }}  type="email" value={supervisorForm.email}
                      name="new-supervisor-email" autoComplete="off"
                      onChange={e => { setSupervisorForm({ ...supervisorForm, email: e.target.value }); if (supervisorErrors.email) setSupervisorErrors(prev => ({ ...prev, email: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${supervisorErrors.email ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`} />
                    {supervisorErrors.email && <p className="text-[11px] text-red-500 mt-1 font-medium">* {supervisorErrors.email}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Gender <span className="text-red-500">*</span></label>
                    <select ref={el => { if (supervisorFieldRefs.current) supervisorFieldRefs.current.gender = el; }}  value={supervisorForm.gender}
                      onChange={e => { setSupervisorForm({ ...supervisorForm, gender: e.target.value }); if (supervisorErrors.gender) setSupervisorErrors(prev => ({ ...prev, gender: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${supervisorErrors.gender ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`}>
                      <option value="" disabled>Select gender</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                    {supervisorErrors.gender && <p className="text-[11px] text-red-500 mt-1 font-medium">* {supervisorErrors.gender}</p>}
                  </div>
                </div>
                {/* <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Password <span className="text-red-500">*</span></label>
                    <input ref={el => { if (supervisorFieldRefs.current) supervisorFieldRefs.current.password = el; }}  type="password" value={supervisorForm.password}
                      name="new-supervisor-password" autoComplete="new-password"
                      onChange={e => { setSupervisorForm({ ...supervisorForm, password: e.target.value}); if (supervisorErrors.password) setSupervisorErrors(prev => ({ ...prev, password: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${supervisorErrors.password ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`} />
{ supervisorErrors.password && <p className="text-[11px] text-red-500 mt-1 font-medium">* {supervisorErrors.password}</p> }
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Confirm <span className="text-red-500">*</span></label>
                    <input ref={el => { if (supervisorFieldRefs.current) supervisorFieldRefs.current.confirmPassword = el; }}  type="password" value={supervisorForm.confirmPassword}
                      name="new-supervisor-confirm-password" autoComplete="new-password"
                      onChange={e => { setSupervisorForm({ ...supervisorForm, confirmPassword: e.target.value}); if (supervisorErrors.confirmPassword) setSupervisorErrors(prev => ({ ...prev, confirmPassword: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${supervisorErrors.confirmPassword ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`} />
{ supervisorErrors.confirmPassword && <p className="text-[11px] text-red-500 mt-1 font-medium">* {supervisorErrors.confirmPassword}</p> }
                    {supervisorForm.password && supervisorForm.confirmPassword && supervisorForm.password !== supervisorForm.confirmPassword && (
                      <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
                    )}
                  </div>
                </div> */}
                <div className="border-t border-gray-100 my-4" />
                <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">
                  Documents
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">PAN Card Number</label>
                    <input ref={el => { if (supervisorFieldRefs.current) supervisorFieldRefs.current.pan_number = el; }}  type="text" placeholder="ABCDE1234F" value={supervisorForm.pan_number}
                      onChange={e => { setSupervisorForm({ ...supervisorForm, pan_number: e.target.value.toUpperCase().slice(0, 10) }); if (supervisorErrors.pan_number) setSupervisorErrors(prev => ({ ...prev, pan_number: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${supervisorErrors.pan_number ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E] font-mono`} />
                    {supervisorErrors.pan_number && <p className="text-[11px] text-red-500 mt-1 font-medium">* {supervisorErrors.pan_number}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Bank Account Number</label>
                    <input ref={el => { if (supervisorFieldRefs.current) supervisorFieldRefs.current.bank_account_number = el; }}  type="text" inputMode="numeric" value={supervisorForm.bank_account_number}
                      onChange={e => { setSupervisorForm({ ...supervisorForm, bank_account_number: e.target.value.replace(/\D/g, "").slice(0, 18) }); if (supervisorErrors.bank_account_number) setSupervisorErrors(prev => ({ ...prev, bank_account_number: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${supervisorErrors.bank_account_number ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`} />
                    {supervisorErrors.bank_account_number && <p className="text-[11px] text-red-500 mt-1 font-medium">* {supervisorErrors.bank_account_number}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Bank IFSC Code</label>
                    <input ref={el => { if (supervisorFieldRefs.current) supervisorFieldRefs.current.bank_ifsc = el; }}  type="text" placeholder="SBIN0001234" value={supervisorForm.bank_ifsc}
                      onChange={e => { setSupervisorForm({ ...supervisorForm, bank_ifsc: e.target.value.toUpperCase().slice(0, 11) }); if (supervisorErrors.bank_ifsc) setSupervisorErrors(prev => ({ ...prev, bank_ifsc: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${supervisorErrors.bank_ifsc ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E] font-mono`} />
                    {supervisorErrors.bank_ifsc && <p className="text-[11px] text-red-500 mt-1 font-medium">* {supervisorErrors.bank_ifsc}</p>}
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Aadhar Number <span className="text-red-500">*</span></label>
                    <input ref={el => { if (supervisorFieldRefs.current) supervisorFieldRefs.current.aadhar_number = el; }}  type="text" inputMode="numeric" value={supervisorForm.aadhar_number}
                      onChange={e => { setSupervisorForm({ ...supervisorForm, aadhar_number: e.target.value.replace(/\D/g, "").slice(0, 12) }); if (supervisorErrors.aadhar_number) setSupervisorErrors(prev => ({ ...prev, aadhar_number: undefined })); }}
                      className={`w-full px-4 py-2 rounded-xl border ${supervisorErrors.aadhar_number ? "border-red-400" : "border-gray-200"} focus:outline-none focus:border-[#1A3C6E]`} />
                    {supervisorErrors.aadhar_number && <p className="text-[11px] text-red-500 mt-1 font-medium">* {supervisorErrors.aadhar_number}</p>}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                    Aadhar Photo <span className="text-red-500">*</span>
                  </label>
                  <div ref={el => { if (supervisorFieldRefs.current) supervisorFieldRefs.current.supAadharPhoto = el; }}  className="relative group">
                    <div
                      onClick={() => document.getElementById("sup-aadhar-photo-input").click()}
                      className={`w-full border-2 border-dashed ${supervisorErrors.supAadharPhoto ? "border-red-400" : "border-gray-200"} rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer hover:border-[#1A3C6E] transition`}
                    >
                      {supAadharPhotoPreview ? (
                        <img src={supAadharPhotoPreview} alt="Aadhar"
                          className="h-24 w-full object-cover rounded-lg" />
                      ) : (
                        <>
                          <span className="text-2xl mb-1">📄</span>
                          <span className="text-xs text-gray-400">Click to upload aadhar photo</span>
                        </>
                      )}
                    </div>
                    {supAadharPhotoPreview && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSupAadharPhotoPreview(null);
                          setSupAadharPhotoFile(null);
                        }}
                        className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-400 hover:text-red-500 hover:border-red-200 transition-all z-10"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <input
                    id="sup-aadhar-photo-input"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => { handleSupAadharPhoto(e); if (supervisorErrors.supAadharPhoto) setSupervisorErrors(prev => ({ ...prev, supAadharPhoto: undefined })); }}
                  />
                </div>
                {supervisorErrors.supAadharPhoto && <p className="text-[11px] text-red-500 mt-1 font-medium">* {supervisorErrors.supAadharPhoto}</p>}

                <p className="text-xs text-gray-400 mb-2"><span className="text-red-500">*</span> Required fields</p>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setSupervisorModal(false)}
                    className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50">Cancel</button>
                  <button type="submit" disabled={savingSupervisor}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-[#0F2044] text-white font-semibold hover:bg-[#1A3C6E] disabled:opacity-60 transition shadow-md">
                    {savingSupervisor ? "Saving..." : "Add Supervisor"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </OwnerLayout>
  );
}
