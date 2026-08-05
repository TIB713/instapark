import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Car, Lock, Phone, CheckCircle2, Key } from "lucide-react";

export default function OwnerLogin() {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [loginStep, setLoginStep] = useState(1); // 1 = Phone, 2 = Password
  
  // First Login (Activation) State
  const [firstLoginMode, setFirstLoginMode] = useState(false);
  const [firstLoginOtp, setFirstLoginOtp] = useState("");
  const [newCredential, setNewCredential] = useState("");
  const [confirmCredential, setConfirmCredential] = useState("");
  
  // Forgot Password State
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotStep, setForgotStep] = useState(1);
  const [forgotOtp, setForgotOtp] = useState("");
  
  const nav = useNavigate();

  const handleLoginSuccess = (data) => {
    if (data.user.role === "admin") {
      toast.error("This account is an Admin login – please use the mobile app instead.");
      return;
    }
    
    if (data.user.role !== "owner") {
      toast.error("Invalid credentials or role.");
      return;
    }

    localStorage.setItem("owner_token", data.token);
    localStorage.setItem("owner_name", data.user.name);
    localStorage.setItem("owner_provider_type", data.user.provider_type);
    toast.success("Welcome back!");
    nav("/provider/dashboard");
  };

  const checkPhone = async (e) => {
    e.preventDefault();
    if (!/^\d{10}$/.test(phone.trim())) {
      toast.error("Please enter a valid 10-digit mobile number.");
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post("/auth/check-phone", { phone: phone.trim() });
      if (!data.exists) {
        toast.error("No account found with this number.");
        return;
      }
      
      if (data.is_verified) {
        setLoginStep(2);
      } else {
        // Automatically send OTP and jump to first login mode
        try {
          await api.post("/auth/first-login/send-otp", { phone: phone.trim() });
          setFirstLoginMode(true);
          toast.success("OTP sent to activate your account.");
        } catch (err) {
          toast.error("Failed to send OTP.");
        }
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to verify phone number");
    } finally {
      setLoading(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post("/auth/login", { phone: phone.trim(), password });
      handleLoginSuccess(data);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const submitFirstLogin = async (e) => {
    e.preventDefault();
    if (newCredential !== confirmCredential) {
      toast.error("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post("/auth/first-login/verify", {
        phone: phone.trim(),
        otp: firstLoginOtp,
        new_credential: newCredential,
        confirm_credential: confirmCredential
      });
      handleLoginSuccess(data);
    } catch (err) {
      const detail = err.response?.data?.detail;
      const msg = Array.isArray(detail) ? detail.map(d => d.msg).join(", ") : (typeof detail === "string" ? detail : "Failed to activate");
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };
  
  const sendForgotOtp = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { phone: phone.trim() });
      setForgotStep(2);
      toast.success("OTP sent!");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to send OTP.");
    } finally {
      setLoading(false);
    }
  };

  const verifyForgotOtp = async (e) => {
    e.preventDefault();
    if (newCredential !== confirmCredential) {
      toast.error("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      await api.post("/auth/reset-password", {
        phone: phone.trim(),
        otp: forgotOtp,
        new_credential: newCredential,
        confirm_credential: confirmCredential
      });
      setForgotMode(false);
      setForgotStep(1);
      setLoginStep(2);
      toast.success("Password reset successfully! Please log in.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to reset password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-row min-h-screen">
      <div className="hidden md:flex w-[45%] min-h-screen bg-gradient-to-br from-[#0F2044] to-[#1A3C6E] relative px-10 py-12">
        <div className="w-full flex flex-col items-center justify-center text-center">
          <Car className="w-12 h-12 text-white" />
          <div className="font-heading text-4xl font-extrabold text-white tracking-tight mt-3">
            INSTAPARK
          </div>
          <p className="text-white/60 text-lg mt-4">
            Professional Valet Management Platform
          </p>
          <div className="mt-8 flex flex-col gap-3 text-left">
            {[
              "Real-time WebSocket tracking",
              "Multi-tenant provider management",
              "Guest QR retrieval flow",
            ].map((item) => (
              <div key={item} className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="text-white/70 text-sm">{item}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="absolute bottom-8 left-10 text-white/30 text-xs">
          © 2026 InstaPark
        </div>
      </div>

      <div className="w-full md:w-[55%] bg-[#F9FAFB] flex items-center justify-center min-h-screen px-4 py-10">
        <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-8 max-w-sm w-full fade-in-up relative">
          <h1 className="font-heading text-3xl font-bold text-[#0F2044] mb-1">Welcome back</h1>
          <p className="text-sm uppercase tracking-[0.18em] text-gray-500 font-medium mb-6">Owner Portal</p>

          {!firstLoginMode && !forgotMode && loginStep === 1 && (
            <form onSubmit={checkPhone} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Mobile Number <span className="text-red-500">*</span></label>
                <div className="relative mt-1">
                  <Phone className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} required
                    placeholder="10-digit mobile number"
                    className="w-full pl-10 pr-3 py-3 rounded-xl border border-gray-200 focus:border-[#1A3C6E] focus:ring-2 focus:ring-[#1A3C6E]/20 outline-none" />
                </div>
              </div>
              <button disabled={loading}
                className="w-full btn-primary-navy rounded-xl py-3 font-semibold disabled:opacity-60">
                {loading ? "Checking…" : "Continue"}
              </button>
            </form>
          )}

          {!firstLoginMode && !forgotMode && loginStep === 2 && (
            <form onSubmit={submit} className="space-y-4" data-testid="owner-login-form">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Mobile Number</label>
                  <button type="button" onClick={() => setLoginStep(1)} className="text-xs text-[#1A3C6E] font-semibold hover:underline">Change</button>
                </div>
                <div className="relative">
                  <Phone className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="text" value={phone} disabled
                    className="w-full pl-10 pr-3 py-3 rounded-xl border border-gray-200 bg-gray-50 text-gray-500 outline-none" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Password <span className="text-red-500">*</span></label>
                <div className="relative mt-1">
                  <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input data-testid="login-password-input" type="password" value={password}
                    onChange={(e) => setPassword(e.target.value)} required
                    className="w-full pl-10 pr-3 py-3 rounded-xl border border-gray-200 focus:border-[#1A3C6E] focus:ring-2 focus:ring-[#1A3C6E]/20 outline-none" />
                </div>
              </div>
              
              <div className="text-right">
                <button type="button" onClick={() => setForgotMode(true)} className="text-sm text-[#1A3C6E] font-semibold hover:underline">Forgot Password?</button>
              </div>

              <button data-testid="login-submit-btn" disabled={loading}
                className="w-full btn-primary-navy rounded-xl py-3 font-semibold disabled:opacity-60">
                {loading ? "Signing in…" : "Sign In"}
              </button>
            </form>
          )}

          {firstLoginMode && (
            <form onSubmit={submitFirstLogin} className="space-y-4">
              <h2 className="text-xl font-bold text-[#0F2044] mb-2">Activate Account</h2>
              <p className="text-sm text-gray-600 mb-4">Please enter the OTP sent to your mobile number and set a new password.</p>
              
              <div>
                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">OTP <span className="text-red-500">*</span></label>
                <div className="relative mt-1">
                  <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="text" value={firstLoginOtp} onChange={(e) => setFirstLoginOtp(e.target.value)} required
                    className="w-full pl-10 pr-3 py-3 rounded-xl border border-gray-200 focus:border-[#1A3C6E] focus:ring-2 focus:ring-[#1A3C6E]/20 outline-none" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">New Password <span className="text-red-500">*</span></label>
                <div className="relative mt-1">
                  <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="password" value={newCredential} onChange={(e) => setNewCredential(e.target.value)} required
                    className="w-full pl-10 pr-3 py-3 rounded-xl border border-gray-200 focus:border-[#1A3C6E] focus:ring-2 focus:ring-[#1A3C6E]/20 outline-none" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Confirm Password <span className="text-red-500">*</span></label>
                <div className="relative mt-1">
                  <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="password" value={confirmCredential} onChange={(e) => setConfirmCredential(e.target.value)} required
                    className="w-full pl-10 pr-3 py-3 rounded-xl border border-gray-200 focus:border-[#1A3C6E] focus:ring-2 focus:ring-[#1A3C6E]/20 outline-none" />
                </div>
              </div>

              <button disabled={loading} className="w-full btn-primary-navy rounded-xl py-3 font-semibold disabled:opacity-60">
                {loading ? "Activating…" : "Activate & Login"}
              </button>
              <button type="button" onClick={() => { setFirstLoginMode(false); setLoginStep(1); }} className="w-full text-gray-500 text-sm mt-2">Cancel / Change Number</button>
            </form>
          )}

          {forgotMode && (
            <form onSubmit={forgotStep === 1 ? sendForgotOtp : verifyForgotOtp} className="space-y-4">
              <h2 className="text-xl font-bold text-[#0F2044] mb-2">Reset Password</h2>
              
              {forgotStep === 1 && (
                <>
                  <p className="text-sm text-gray-600 mb-4">Enter your mobile number to receive a reset OTP.</p>
                  <div>
                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Mobile Number <span className="text-red-500">*</span></label>
                    <div className="relative mt-1">
                      <Phone className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} required disabled={loginStep === 2}
                        className="w-full pl-10 pr-3 py-3 rounded-xl border border-gray-200 focus:border-[#1A3C6E] focus:ring-2 focus:ring-[#1A3C6E]/20 outline-none" />
                    </div>
                  </div>
                  <button disabled={loading} className="w-full btn-primary-navy rounded-xl py-3 font-semibold disabled:opacity-60">
                    {loading ? "Sending…" : "Send OTP"}
                  </button>
                </>
              )}

              {forgotStep === 2 && (
                <>
                  <p className="text-sm text-gray-600 mb-4">Enter the OTP and your new password.</p>
                  <div>
                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">OTP <span className="text-red-500">*</span></label>
                    <div className="relative mt-1">
                      <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input type="text" value={forgotOtp} onChange={(e) => setForgotOtp(e.target.value)} required
                        className="w-full pl-10 pr-3 py-3 rounded-xl border border-gray-200 focus:border-[#1A3C6E] focus:ring-2 focus:ring-[#1A3C6E]/20 outline-none" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">New Password <span className="text-red-500">*</span></label>
                    <div className="relative mt-1">
                      <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input type="password" value={newCredential} onChange={(e) => setNewCredential(e.target.value)} required
                        className="w-full pl-10 pr-3 py-3 rounded-xl border border-gray-200 focus:border-[#1A3C6E] focus:ring-2 focus:ring-[#1A3C6E]/20 outline-none" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Confirm Password <span className="text-red-500">*</span></label>
                    <div className="relative mt-1">
                      <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input type="password" value={confirmCredential} onChange={(e) => setConfirmCredential(e.target.value)} required
                        className="w-full pl-10 pr-3 py-3 rounded-xl border border-gray-200 focus:border-[#1A3C6E] focus:ring-2 focus:ring-[#1A3C6E]/20 outline-none" />
                    </div>
                  </div>
                  <button disabled={loading} className="w-full btn-primary-navy rounded-xl py-3 font-semibold disabled:opacity-60">
                    {loading ? "Resetting…" : "Reset Password"}
                  </button>
                </>
              )}
              <button type="button" onClick={() => { setForgotMode(false); setForgotStep(1); }} className="w-full text-gray-500 text-sm mt-2">Cancel</button>
            </form>
          )}

        </div>
      </div>
    </div>
  );
}
