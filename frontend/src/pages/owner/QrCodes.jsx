import { useEffect, useState, useMemo } from "react";
import OwnerLayout from "@/components/layout/OwnerLayout";
import { api, API } from "@/lib/api";
import { QRCodeSVG } from "qrcode.react";
import QRCode from "qrcode";
import { fmtDate } from "@/lib/time";
import { Search, X, QrCode, AlertTriangle, Calendar, Download, Share2 } from "lucide-react";
import { toast } from "sonner";
import EmptyState from "@/components/ui/EmptyState";

export default function OwnerQrCodes() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [modalCard, setModalCard] = useState(null);
  const [isReporting, setIsReporting] = useState(false);
  const [reportReason, setReportReason] = useState("lost");
  const [reportNote, setReportNote] = useState("");
  const [submittingReport, setSubmittingReport] = useState(false);

  const [selectedQrDate, setSelectedQrDate] = useState(null);
  const [qrPage, setQrPage] = useState(1);
  const QR_TAGS_PER_PAGE = 24;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    fetchCards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const fetchCards = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/qr-cards/me", {
        params: { search: debouncedSearch || undefined }
      });
      setCards(data.cards || []);
    } catch {
      toast.error("Failed to load QR cards");
    } finally {
      setLoading(false);
    }
  };

  const submitReport = async () => {
    if (!modalCard) return;
    setSubmittingReport(true);
    try {
      await api.post(`/qr-cards/${modalCard.id}/report-incident`, {
        reason: reportReason,
        note: reportNote
      });
      toast.success("Incident reported successfully");
      setModalCard(null);
      setIsReporting(false);
      setReportNote("");
      fetchCards();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to report incident");
    } finally {
      setSubmittingReport(false);
    }
  };

  const getDateKey = (iso) => {
    if (!iso) return "unknown";
    const utcStr = iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z";
    return new Date(utcStr).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  };

  const qrGroupsByDate = useMemo(() => {
    const map = new Map();
    for (const c of cards) {
      const key = getDateKey(c.created_at);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(c);
    }
    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
      .map(([dateKey, groupCards]) => ({
        dateKey,
        label: dateKey === "unknown" ? "Unknown Date" : fmtDate(groupCards[0].created_at),
        cards: groupCards,
      }));
  }, [cards]);

  useEffect(() => {
    if (qrGroupsByDate.length === 0) {
      setSelectedQrDate(null);
      return;
    }
    const stillExists = qrGroupsByDate.some(g => g.dateKey === selectedQrDate);
    if (!stillExists) {
      setSelectedQrDate(qrGroupsByDate[0].dateKey);
      setQrPage(1);
    }
  }, [qrGroupsByDate]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setQrPage(1);
  }, [selectedQrDate]);

  const selectedQrGroup = qrGroupsByDate.find(g => g.dateKey === selectedQrDate) || null;
  const qrTotalPages = selectedQrGroup ? Math.max(1, Math.ceil(selectedQrGroup.cards.length / QR_TAGS_PER_PAGE)) : 1;
  const qrVisibleCards = selectedQrGroup
    ? selectedQrGroup.cards.slice((qrPage - 1) * QR_TAGS_PER_PAGE, (qrPage - 1) * QR_TAGS_PER_PAGE + QR_TAGS_PER_PAGE)
    : [];

  const qrCardToPngDataUrl = (card) =>
    QRCode.toDataURL(`${API}/qr-redirect/${card.qr_token}`, {
      width: 300,
      margin: 2,
      color: { dark: "#0F2044", light: "#FFFFFF" },
    });

  const handleDownloadDateGroup = async (group) => {
    if (group.cards.length > 5) {
      const ok = window.confirm(`This will download ${group.cards.length} QR images individually. Your browser may ask permission to allow multiple downloads — please click "Allow" if prompted. Continue?`);
      if (!ok) return;
    }
    let successCount = 0;
    for (const c of group.cards) {
      try {
        const dataUrl = await qrCardToPngDataUrl(c);
        const a = document.createElement("a");
        a.download = `Tag-${c.key_tag_number}-${group.dateKey}.png`;
        a.href = dataUrl;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        successCount++;
        await new Promise((r) => setTimeout(r, 400));
      } catch {
        // skip and continue
      }
    }
    if (successCount === group.cards.length) {
      toast.success(`Downloaded all ${successCount} QR code(s) from ${group.label}`);
    } else {
      toast.error(`Downloaded ${successCount} of ${group.cards.length} QR code(s) from ${group.label} — some failed`);
    }
  };

  const handleShareDateGroup = async (group) => {
    try {
      const files = [];
      for (const c of group.cards) {
        const dataUrl = await qrCardToPngDataUrl(c);
        const blob = await (await fetch(dataUrl)).blob();
        files.push(new File([blob], `Tag-${c.key_tag_number}.png`, { type: "image/png" }));
      }
      if (navigator.canShare && navigator.canShare({ files })) {
        await navigator.share({
          title: `QR Codes added on ${group.label}`,
          text: `${group.cards.length} QR tag(s) added on ${group.label}`,
          files,
        });
      } else {
        const links = group.cards.map((c) => `${API}/qr-redirect/${c.qr_token}`).join("\n");
        await navigator.clipboard.writeText(links);
        toast.success(`Copied ${group.cards.length} QR link(s) from ${group.label} to clipboard`);
      }
    } catch (err) {
      if (err?.name !== "AbortError") toast.error("Failed to share QR codes for this date");
    }
  };

  return (
    <OwnerLayout title="QR Codes">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold text-[#0F2044]">QR Codes</h1>
        <p className="text-gray-500 text-sm">View and search your assigned key-tag QR codes.</p>
      </div>

      <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-4 mb-6">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by Key Tag Number..."
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 outline-none focus:border-[#1A3C6E]"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center p-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0F2044]"></div></div>
      ) : cards.length > 0 ? (
        <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-gray-400" />
              <select
                value={selectedQrDate || ""}
                onChange={(e) => setSelectedQrDate(e.target.value)}
                className="px-3 py-2 rounded-lg border border-gray-200 outline-none focus:border-[#1A3C6E] text-sm font-bold text-[#0F2044] bg-white"
              >
                {qrGroupsByDate.map(g => (
                  <option key={g.dateKey} value={g.dateKey}>
                    {g.label} ({g.cards.length} tag{g.cards.length !== 1 ? "s" : ""})
                  </option>
                ))}
              </select>
            </div>
            {selectedQrGroup && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDownloadDateGroup(selectedQrGroup)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 bg-white hover:bg-gray-50 text-xs font-bold transition-colors"
                >
                  <Download className="w-3.5 h-3.5" /> Download All
                </button>
                <button
                  onClick={() => handleShareDateGroup(selectedQrGroup)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 bg-white hover:bg-gray-50 text-xs font-bold transition-colors"
                >
                  <Share2 className="w-3.5 h-3.5" /> Share
                </button>
              </div>
            )}
          </div>

          {selectedQrGroup && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {qrVisibleCards.map(c => (
                  <div key={c.id} onClick={() => { setModalCard(c); setIsReporting(false); }} className="bg-white border border-gray-100 rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer hover:shadow-md transition-shadow group relative">
                    {c.status === "pending_incident" && (
                      <div className="absolute top-2 right-2 text-amber-500 bg-amber-50 rounded-full p-1" title="Pending Incident Review">
                        <AlertTriangle className="w-4 h-4" />
                      </div>
                    )}
                    <div className="bg-gray-50 p-2 rounded-lg mb-3 group-hover:scale-105 transition-transform">
                      <QRCodeSVG value={`${API}/qr-redirect/${c.qr_token}`} size={80} />
                    </div>
                    <div className="font-bold text-gray-700 text-sm">Tag #{c.key_tag_number}</div>
                  </div>
                ))}
              </div>

              {qrTotalPages > 1 && (
                <div className="flex items-center justify-between gap-3 mt-4 pt-4 border-t border-gray-100">
                  <span className="text-xs text-gray-400">
                    Showing {qrVisibleCards.length} of {selectedQrGroup.cards.length} tags
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setQrPage(p => Math.max(1, p - 1))}
                      disabled={qrPage === 1}
                      className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-bold text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Previous
                    </button>
                    <span className="text-xs text-gray-500 font-medium px-1">Page {qrPage} of {qrTotalPages}</span>
                    <button
                      onClick={() => setQrPage(p => Math.min(qrTotalPages, p + 1))}
                      disabled={qrPage === qrTotalPages}
                      className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-bold text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <EmptyState 
          icon={<QrCode className="w-8 h-8" />} 
          title="No QR Codes Found" 
          description="Try adjusting your search criteria." 
          theme="owner"
        />
      )}

      {/* Zoom Modal */}
      {modalCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => { setModalCard(null); setIsReporting(false); }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-100 shrink-0">
              <h3 className="font-heading text-lg font-bold text-[#0F2044]">Tag #{modalCard.key_tag_number}</h3>
              <button onClick={() => { setModalCard(null); setIsReporting(false); }} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-8 flex flex-col items-center justify-center bg-gray-50">
              <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                <QRCodeSVG value={`${API}/qr-redirect/${modalCard.qr_token}`} size={200} />
              </div>
              <div className="mt-6 font-bold text-gray-600 text-xl tracking-wider">#{modalCard.key_tag_number}</div>
            </div>
            
            <div className="p-4 border-t border-gray-100 bg-white">
              {modalCard.status === "pending_incident" ? (
                <div className="flex items-center gap-2 text-amber-600 bg-amber-50 p-3 rounded-xl border border-amber-200">
                  <AlertTriangle className="w-5 h-5 shrink-0" />
                  <p className="text-sm font-semibold">Reported as lost/damaged — awaiting superadmin review</p>
                </div>
              ) : !isReporting ? (
                <button onClick={() => setIsReporting(true)} className="w-full py-2.5 rounded-xl border border-red-200 text-red-600 font-semibold hover:bg-red-50 transition-colors">
                  Report Lost / Damaged
                </button>
              ) : (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Reason</label>
                    <div className="flex gap-2">
                      <button onClick={() => setReportReason("lost")} className={`flex-1 py-2 rounded-lg text-sm font-semibold border ${reportReason === "lost" ? "bg-red-50 border-red-200 text-red-700" : "bg-white border-gray-200 text-gray-600"}`}>Lost</button>
                      <button onClick={() => setReportReason("damaged")} className={`flex-1 py-2 rounded-lg text-sm font-semibold border ${reportReason === "damaged" ? "bg-red-50 border-red-200 text-red-700" : "bg-white border-gray-200 text-gray-600"}`}>Damaged</button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Note (Optional)</label>
                    <textarea value={reportNote} onChange={e => setReportNote(e.target.value)} rows="2" className="w-full px-3 py-2 rounded-xl border border-gray-200 outline-none focus:border-[#1A3C6E] text-sm" placeholder="Any details..." />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button onClick={() => setIsReporting(false)} className="flex-1 py-2 rounded-xl border border-gray-200 text-gray-600 font-semibold hover:bg-gray-50 transition-colors">Cancel</button>
                    <button onClick={submitReport} disabled={submittingReport} className="flex-1 py-2 rounded-xl bg-red-600 text-white font-semibold hover:bg-red-700 transition-colors disabled:opacity-50">
                      {submittingReport ? "Submitting..." : "Submit Report"}
                    </button>
                  </div>
                </div>
              )}
            </div>
            
          </div>
        </div>
      )}
    </OwnerLayout>
  );
}
