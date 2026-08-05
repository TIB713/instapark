import { useState } from "react";
import { useParams } from "react-router-dom";
import { Mail, Lock, KeyRound, Eye, EyeOff, Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";

export default function ProviderVerify() {
  const { token } = useParams();
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [success, setSuccess] = useState(false);

  const rules = {
    length: newPassword.length >= 8,
    upper: /[A-Z]/.test(newPassword),
    number: /[0-9]/.test(newPassword),
    special: /[^A-Za-z0-9]/.test(newPassword),
    match: newPassword.length > 0 && newPassword === confirmPassword,
  };

  const completeVerification = async (e) => {
    e.preventDefault();
    setErrorMsg("");
    if (!Object.values(rules).every(Boolean)) {
      setErrorMsg("Please satisfy all password requirements.");
      return;
    }
    if (otp.length !== 6) {
      setErrorMsg("Please enter a valid 6-digit OTP.");
      return;
    }
    setLoading(true);
    try {
      await api.post("/auth/provider/complete-verification", {
        token,
        otp,
        new_password: newPassword,
      });
      setSuccess(true);
    } catch (err) {
      setErrorMsg(err.response?.data?.detail || "Failed to activate account.");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col justify-center items-center p-4">
        <div className="w-full max-w-md bg-white rounded-xl shadow-lg overflow-hidden border border-gray-100 text-center p-8">
          <div className="w-16 h-16 bg-[#7C3AED]/10 text-[#7C3AED] rounded-full flex items-center justify-center mx-auto mb-6">
            <Check className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-black text-gray-900 mb-2">Account Activated!</h2>
          <p className="text-gray-500 mb-8">You can now log in to the InstaPark app using your new password.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-xl overflow-hidden border border-gray-100">
        <div className="bg-[#7C3AED] px-8 py-6 text-center">
          <h1 className="text-2xl font-black text-white tracking-wide">InstaPark</h1>
          <p className="text-[#7C3AED] text-sm mt-1 bg-white/20 inline-block px-3 py-1 rounded-full font-semibold">
            Provider Verification
          </p>
        </div>

        <div className="p-8">
          {errorMsg && (
            <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-lg text-sm font-medium flex items-start gap-2 border border-red-100">
              <X className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

            <form onSubmit={completeVerification} className="space-y-6">
              <div className="text-center mb-6">
                <h2 className="text-xl font-bold text-gray-900">Verify & Set Password</h2>
                <p className="text-gray-500 text-sm mt-2">
                  Enter the OTP sent to your email and set your password.
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">OTP</label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type="text"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ""))}
                    maxLength={6}
                    className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#7C3AED]/20 focus:border-[#7C3AED] text-lg font-bold tracking-widest text-center"
                    placeholder="••••••"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">New Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={newPassword}
                    name="new-password" autoComplete="new-password"
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full pl-10 pr-12 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#7C3AED]/20 focus:border-[#7C3AED]"
                    placeholder="Create a strong password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Confirm Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type={showConfirm ? "text" : "password"}
                    value={confirmPassword}
                    name="confirm-password" autoComplete="new-password"
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full pl-10 pr-12 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#7C3AED]/20 focus:border-[#7C3AED]"
                    placeholder="Confirm your password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showConfirm ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
                <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Password Requirements</p>
                <ul className="space-y-1.5">
                  <RuleItem met={rules.length} text="At least 8 characters" />
                  <RuleItem met={rules.upper} text="At least 1 uppercase letter" />
                  <RuleItem met={rules.number} text="At least 1 number" />
                  <RuleItem met={rules.special} text="At least 1 special character" />
                  <RuleItem met={rules.match} text="Passwords match" />
                </ul>
              </div>

              <button
                type="submit"
                disabled={loading || !otp || !newPassword || !confirmPassword || newPassword !== confirmPassword}
                className="w-full bg-[#7C3AED] text-white py-3 rounded-lg font-bold hover:bg-[#6D28D9] disabled:opacity-50 transition-all flex justify-center items-center"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Activate Account"}
              </button>
            </form>
        </div>
      </div>
    </div>
  );
}

function RuleItem({ met, text }) {
  return (
    <li className="flex items-center text-sm">
      {met ? (
        <Check className="w-4 h-4 text-green-500 mr-2" />
      ) : (
        <X className="w-4 h-4 text-gray-300 mr-2" />
      )}
      <span className={met ? "text-green-700" : "text-gray-500"}>{text}</span>
    </li>
  );
}
