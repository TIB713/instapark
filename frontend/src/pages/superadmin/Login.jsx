import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Car, Lock, Mail, CheckCircle2 } from "lucide-react";

export default function Login() {
  const [email, setEmail] = useState("superadmin@instapark.com");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotStep, setForgotStep] = useState(1);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotOtp, setForgotOtp] = useState("");
  const [forgotPassword, setForgotPassword] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState("");
  const [forgotSuccess, setForgotSuccess] = useState("");
  const nav = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post("/auth/superadmin/login", { email, password });
      localStorage.setItem("superadmin_token", data.token);
      localStorage.setItem("superadmin_name", data.superadmin.name);
      toast.success("Welcome back!");
      nav("/superadmin/dashboard");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const sendOtp = async () => {
    setForgotError("");
    if (!forgotEmail.trim()) {
      setForgotError("Email is required");
      return;
    }
    setForgotLoading(true);
    try {
      await api.post("/auth/superadmin/forgot-password", {
        email: forgotEmail.trim()
      });
      setForgotStep(2);
      setForgotSuccess("OTP sent successfully to your email");
    } catch (e) {
      setForgotError(
        e.response?.data?.detail || "Failed to send OTP"
      );
      if (e.response?.status === 404) setForgotEmail("");
    } finally {
      setForgotLoading(false);
    }
  };

  const resetPassword = async () => {
    setForgotError("");
    if (!forgotOtp.trim() || !forgotPassword.trim()) {
      setForgotError("OTP and new password are required");
      return;
    }
    setForgotLoading(true);
    try {
      await api.post("/auth/superadmin/reset-password", {
        email: forgotEmail.trim(),
        otp: forgotOtp.trim(),
        new_password: forgotPassword.trim()
      });
      setForgotStep(3);
      setForgotSuccess("Password reset successfully!");
    } catch (e) {
      setForgotError(
        e.response?.data?.detail || "Invalid or expired OTP"
      );
    } finally {
      setForgotLoading(false);
    }
  };

  const resetFlow = () => {
    setForgotMode(false);
    setForgotStep(1);
    setForgotEmail("");
    setForgotOtp("");
    setForgotPassword("");
    setForgotError("");
    setForgotSuccess("");
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
          <p className="text-sm uppercase tracking-[0.18em] text-gray-500 font-medium mb-6">Superadmin Portal</p>

          <form onSubmit={submit} className="space-y-4" data-testid="superadmin-login-form">
            <div>
              <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Email <span className="text-red-500">*</span></label>
              <div className="relative mt-1">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input data-testid="login-email-input" type="email" value={email}
                  onChange={(e) => setEmail(e.target.value)} required
                  name="superadmin-login-email" autoComplete="username"
                  className="w-full pl-10 pr-3 py-3 rounded-xl border border-gray-200 focus:border-[#1A3C6E] focus:ring-2 focus:ring-[#1A3C6E]/20 outline-none" />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Password <span className="text-red-500">*</span></label>
              <div className="relative mt-1">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input data-testid="login-password-input" type="password" value={password}
                  onChange={(e) => setPassword(e.target.value)} required
                  name="superadmin-login-password" autoComplete="current-password"
                  className="w-full pl-10 pr-3 py-3 rounded-xl border border-gray-200 focus:border-[#1A3C6E] focus:ring-2 focus:ring-[#1A3C6E]/20 outline-none" />
              </div>
            </div>
            <button data-testid="login-submit-btn" disabled={loading}
              className="w-full btn-primary-navy rounded-xl py-3 font-semibold disabled:opacity-60">
              {loading ? "Signing in…" : "Sign In"}
            </button>
            <div className="text-center mt-2">
              
<p className="text-xs text-gray-400 mb-2"><span className="text-red-500">*</span> Required fields</p>
                  <button
                type="button"
                onClick={() => setForgotMode(true)}
                className="text-sm text-[#1A3C6E]/60
                  hover:text-[#1A3C6E] transition font-medium"
              >
                Forgot Password?
              </button>
            </div>
          </form>
          {/* <p className="mt-6 text-xs text-gray-400 text-center">
            Default: superadmin@instapark.com / Admin@123
          </p> */}

          {forgotMode && (
            <div className="absolute inset-0 bg-white
              rounded-3xl p-8 sm:p-10 flex flex-col">

              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="font-heading text-xl font-bold
                    text-[#0F2044]">
                    {forgotStep === 3
                      ? "Password Reset!" : "Reset Password"}
                  </h2>
                  <p className="text-sm text-gray-500 mt-1">
                    {forgotStep === 1
                      ? "Enter your superadmin email"
                      : forgotStep === 2
                        ? "Enter the OTP from your email"
                        : "You can now login with your new password"}
                  </p>
                </div>
                <button
                  onClick={resetFlow}
                  className="text-gray-400 hover:text-gray-600
                    transition"
                >
                  ✕
                </button>
              </div>

              {/* Step 1 */}
              {forgotStep === 1 && (
                <div className="flex flex-col gap-4 flex-1">
                  <div>
                    <label className="text-xs font-semibold
                      text-gray-600 uppercase tracking-wider">
                      Email
                    </label>
                    <div className="relative mt-1">
                      <Mail className="w-4 h-4 absolute left-3
                        top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="email"
                        value={forgotEmail}
                        onChange={e => setForgotEmail(e.target.value)}
                        placeholder="superadmin@email.com"
                        className="w-full pl-10 pr-3 py-3 rounded-xl
                          border border-gray-200
                          focus:border-[#1A3C6E]
                          focus:ring-2 focus:ring-[#1A3C6E]/20
                          outline-none text-sm"
                      />
                    </div>
                  </div>
                  {forgotError && (
                    <p className="text-red-500 text-sm">
                      {forgotError}
                    </p>
                  )}
                  <button
                    onClick={sendOtp}
                    disabled={forgotLoading}
                    className="w-full py-3 rounded-xl
                      bg-[#0F2044] text-white font-semibold
                      hover:bg-[#1A3C6E] transition
                      disabled:opacity-60 mt-auto"
                  >
                    {forgotLoading ? "Sending..." : "Send OTP"}
                  </button>
                </div>
              )}

              {/* Step 2 */}
              {forgotStep === 2 && (
                <div className="flex flex-col gap-4 flex-1">
                  {forgotSuccess && (
                    <div className="bg-emerald-50 text-emerald-700
                      rounded-xl px-4 py-3 text-sm font-medium">
                      {forgotSuccess}
                    </div>
                  )}
                  <div>
                    <label className="text-xs font-semibold
                      text-gray-600 uppercase tracking-wider">
                      6-Digit OTP
                    </label>
                    <input
                      type="text"
                      value={forgotOtp}
                      onChange={e => setForgotOtp(e.target.value)}
                      placeholder="123456"
                      maxLength={6}
                      className="w-full mt-1 px-4 py-3 rounded-xl
                        border border-gray-200
                        focus:border-[#1A3C6E]
                        focus:ring-2 focus:ring-[#1A3C6E]/20
                        outline-none text-center text-2xl
                        font-bold tracking-widest"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold
                      text-gray-600 uppercase tracking-wider">
                      New Password
                    </label>
                    <div className="relative mt-1">
                      <Lock className="w-4 h-4 absolute left-3
                        top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="password"
                        value={forgotPassword}
                        onChange={e =>
                          setForgotPassword(e.target.value)}
                        placeholder="Min 6 characters"
                        className="w-full pl-10 pr-3 py-3 rounded-xl
                          border border-gray-200
                          focus:border-[#1A3C6E]
                          focus:ring-2 focus:ring-[#1A3C6E]/20
                          outline-none text-sm"
                      />
                    </div>
                  </div>
                  {forgotError && (
                    <p className="text-red-500 text-sm">
                      {forgotError}
                    </p>
                  )}
                  <button
                    onClick={resetPassword}
                    disabled={forgotLoading}
                    className="w-full py-3 rounded-xl
                      bg-[#0F2044] text-white font-semibold
                      hover:bg-[#1A3C6E] transition
                      disabled:opacity-60 mt-auto"
                  >
                    {forgotLoading
                      ? "Resetting..." : "Reset Password"}
                  </button>
                </div>
              )}

              {/* Step 3 — Success */}
              {forgotStep === 3 && (
                <div className="flex flex-col items-center
                  justify-center flex-1 gap-4">
                  <div className="w-16 h-16 rounded-full
                    bg-emerald-100 flex items-center
                    justify-center text-3xl">
                    ✓
                  </div>
                  <p className="text-emerald-600 font-bold text-lg">
                    Password Reset Successfully!
                  </p>
                  <p className="text-gray-500 text-sm text-center">
                    You can now login with your new password
                  </p>
                  <button
                    onClick={resetFlow}
                    className="w-full py-3 rounded-xl
                      bg-[#0F2044] text-white font-semibold
                      hover:bg-[#1A3C6E] transition mt-4"
                  >
                    Back to Login
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
