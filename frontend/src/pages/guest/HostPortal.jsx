import React, { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Download, Upload, CheckCircle2, AlertTriangle, Users, Share2, Copy } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

export default function HostPortal() {
  const { hostToken } = useParams();
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const [uploading, setUploading] = useState(false);
  const [successCount, setSuccessCount] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const fetchEvent = async () => {
      try {
        const { data } = await api.get(`/host-portal/${hostToken}`);
        setEvent(data);
      } catch (err) {
        setError("Invalid or expired host token.");
      } finally {
        setLoading(false);
      }
    };
    fetchEvent();
  }, [hostToken]);

  const downloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([{ Name: "", Contact: "", "Expected Arrival": "" }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Guests");
    XLSX.writeFile(wb, "GuestList_Template.xlsx");
  };

  const handleDownloadQR = () => {
    const svg = document.getElementById("host-portal-qr");
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement("canvas");
    canvas.width = 300; canvas.height = 300;
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, 300, 300);
      const a = document.createElement("a");
      a.download = "pre-register-qr.png";
      a.href = canvas.toDataURL("image/png");
      a.click();
    };
    img.src = "data:image/svg+xml;base64," + btoa(svgData);
  };

  const handleCopyLink = () => {
    if (!event?.event_qr_token) return;
    navigator.clipboard.writeText(`${window.location.origin}/pre-register/event/${event.event_qr_token}`);
    toast.success("Link copied!");
  };

  const handleShare = async () => {
    if (!event?.event_qr_token) return;
    const url = `${window.location.origin}/pre-register/event/${event.event_qr_token}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Pre-Register for Event',
          text: 'Register your vehicle before you arrive!',
          url: url
        });
      } catch (err) {
        console.error("Error sharing", err);
      }
    } else {
      handleCopyLink();
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".xlsx")) {
      toast.error("Please upload a valid .xlsx file");
      return;
    }

    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);

    try {
      const { data } = await api.post(`/host-portal/${hostToken}/upload`, fd);
      setSuccessCount(data.inserted);
      toast.success(`Successfully added and messaged ${data.inserted} guests`);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Upload failed. Check file format.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#1D4ED8] to-[#1E40AF] flex items-center justify-center p-4">
        <div className="w-10 h-10 rounded-full border-4 border-white/20 border-t-white animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#1D4ED8] to-[#1E40AF] flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl">
          <div className="bg-red-50 text-red-500 p-6 rounded-full mb-6 mx-auto w-24 h-24 flex items-center justify-center">
            <AlertTriangle className="w-12 h-12" />
          </div>
          <h2 className="text-2xl font-black text-[#0F2044] mb-2">Access Denied</h2>
          <p className="text-gray-500 max-w-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1D4ED8] to-[#1E40AF] p-4 sm:p-6 pt-12 overflow-y-auto">
      <div className="max-w-2xl mx-auto space-y-6 pb-24">
        {/* Header */}
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#0F2044]/5 text-[#0F2044] mb-4">
            <Users className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-black text-[#0F2044] mb-1">{event.name}</h1>
          <p className="text-gray-500">{event.venue} • {event.date || "Daily Event"}</p>
        </div>

        {/* Success State */}
        {successCount !== null ? (
          <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100 text-center animate-in fade-in zoom-in duration-300">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-50 text-green-500 mb-6">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <h2 className="text-2xl font-black text-[#0F2044] mb-2">Upload Complete!</h2>
            <p className="text-gray-500 mb-6 max-w-sm mx-auto">
              We've successfully added {successCount} guests to your event and sent them SMS invitations to pre-register.
            </p>
            <button
              onClick={() => setSuccessCount(null)}
              className="px-8 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition-colors"
            >
              Upload More Guests
            </button>
          </div>
        ) : (
          /* Action Cards */
          <div className="space-y-4">
            {/* Step 1 */}
            <div className="bg-white rounded-3xl p-6 sm:p-8 shadow-sm border border-gray-100 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-blue-50 rounded-bl-full -z-10 opacity-50" />
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-black shrink-0">1</div>
                <div>
                  <h3 className="text-lg font-bold text-[#0F2044] mb-2">Download Template</h3>
                  <p className="text-sm text-gray-500 mb-6 leading-relaxed">
                    Start by downloading our standard Excel template. Fill in your guests' names and phone numbers.
                  </p>
                  <button
                    onClick={downloadTemplate}
                    className="flex items-center gap-2 px-6 py-3 bg-blue-50 text-blue-600 font-bold rounded-xl hover:bg-blue-100 transition-colors"
                  >
                    <Download className="w-5 h-5" /> Download .xlsx Template
                  </button>
                </div>
              </div>
            </div>

            {/* Step 2 */}
            <div className="bg-white rounded-3xl p-6 sm:p-8 shadow-sm border border-gray-100 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-[#0F2044]/5 rounded-bl-full -z-10" />
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-full bg-[#0F2044]/10 text-[#0F2044] flex items-center justify-center font-black shrink-0">2</div>
                <div className="w-full">
                  <h3 className="text-lg font-bold text-[#0F2044] mb-2">Upload Guest List</h3>
                  <p className="text-sm text-gray-500 mb-6 leading-relaxed">
                    Upload your completed Excel file. We will automatically register them and send a valet invitation SMS.
                  </p>
                  
                  <input
                    type="file"
                    accept=".xlsx"
                    className="hidden"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                  />
                  
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="w-full flex justify-center items-center gap-2 px-6 py-4 bg-[#0F2044] text-white font-bold rounded-xl hover:bg-[#1A3C6E] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-[#0F2044]/20"
                  >
                    {uploading ? (
                      <>
                        <div className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        Uploading & Sending SMS...
                      </>
                    ) : (
                      <>
                        <Upload className="w-5 h-5" /> Select and Upload File
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Step 3 */}
            <div className="bg-white rounded-3xl p-6 sm:p-8 shadow-sm border border-gray-100 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-blue-50 rounded-bl-full -z-10 opacity-50" />
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-black shrink-0">3</div>
                <div className="w-full">
                  <h3 className="text-lg font-bold text-[#0F2044] mb-2">Pre-Register QR Code</h3>
                  <p className="text-sm text-gray-500 mb-6 leading-relaxed">
                    Alternatively, display this QR code or share the link. Guests can scan it to self-register their vehicle before they arrive.
                  </p>
                  
                  {event?.event_qr_token && (
                    <div className="flex flex-col sm:flex-row gap-6 items-center sm:items-start bg-gray-50 p-6 rounded-2xl border border-gray-100">
                      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 shrink-0">
                        <QRCodeSVG
                          id="host-portal-qr"
                          value={`${window.location.origin}/pre-register/event/${event.event_qr_token}`}
                          size={120}
                        />
                      </div>
                      
                      <div className="flex flex-col gap-3 w-full justify-center">
                        <button
                          onClick={handleDownloadQR}
                          className="w-full flex justify-center items-center gap-2 px-6 py-3 bg-[#0F2044] text-white font-bold rounded-xl hover:bg-[#1A3C6E] transition-all shadow-lg shadow-[#0F2044]/20"
                        >
                          <Download className="w-5 h-5" /> Download QR Image
                        </button>
                        
                        <div className="flex gap-3">
                          <button
                            onClick={handleCopyLink}
                            className="flex-1 flex justify-center items-center gap-2 px-4 py-3 bg-white text-[#0F2044] font-bold rounded-xl hover:bg-gray-50 transition-all border border-gray-200"
                          >
                            <Copy className="w-4 h-4" /> Copy Link
                          </button>
                          
                          <button
                            onClick={handleShare}
                            className="flex-1 flex justify-center items-center gap-2 px-4 py-3 bg-white text-[#0F2044] font-bold rounded-xl hover:bg-gray-50 transition-all border border-gray-200"
                          >
                            <Share2 className="w-4 h-4" /> Share
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
