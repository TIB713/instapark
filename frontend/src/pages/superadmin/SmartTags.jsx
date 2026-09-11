// Smart Contact Tag System — Superadmin QR tag generation and management page
import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Download, Search, Tag, X, QrCode } from "lucide-react";
import SuperLayout from "@/components/layout/SuperLayout";
import { Pagination } from "../../components/ui/pagination";
import { QRCodeSVG } from "qrcode.react";
import QRCode from "qrcode";
import { fmtDateTimeFull } from "@/lib/time";

const PAGE_SIZE = 48;

export default function SmartTags() {
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [generateQuantity, setGenerateQuantity] = useState(10);
  const [generating, setGenerating] = useState(false);
  const [zoomedCard, setZoomedCard] = useState(null);

  const fetchTags = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/smart-tags");
      setTags(data);
    } catch (err) {
      toast.error("Failed to fetch smart tags");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTags();
  }, []);

  const handleGenerate = async (e) => {
    e.preventDefault();
    const qty = parseInt(generateQuantity);
    if (isNaN(qty) || qty < 1 || qty > 500) {
      return toast.error("Quantity must be between 1 and 500");
    }
    setGenerating(true);
    toast.loading(`Generating ${qty} tags...`, { id: "gen" });
    try {
      await api.post("/smart-tags/generate", { quantity: qty });
      toast.success(`Successfully generated ${qty} tags`, { id: "gen" });
      setGenerateQuantity(10);
      setPage(1);
      fetchTags();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to generate tags", { id: "gen" });
    } finally {
      setGenerating(false);
    }
  };

  const filteredTags = useMemo(() => {
    if (!search) return tags;
    return tags.filter(t => t.tag_code.includes(search));
  }, [tags, search]);

  const paginatedTags = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredTags.slice(start, start + PAGE_SIZE);
  }, [filteredTags, page]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const downloadCardPng = async (card) => {
    const dataUrl = await QRCode.toDataURL(
      `${window.location.origin}/t/${card.qr_token}`,
      { margin: 1, width: 512 }
    );

    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 620;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const img = new Image();
    img.src = dataUrl;
    await new Promise((resolve) => {
      img.onload = resolve;
    });
    ctx.drawImage(img, 0, 0, 512, 512);

    ctx.textAlign = "center";
    ctx.fillStyle = "#000000";
    ctx.font = "bold 32px sans-serif";
    ctx.fillText(`Code ${card.tag_code}`, 256, 560);

    const finalDataUrl = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = finalDataUrl;
    a.download = `smart-tag-${card.tag_code}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handlePrintAll = async () => {
    if (filteredTags.length === 0) return toast.error("No tags to print");
    toast.loading("Preparing print view...", { id: "print-all" });
    try {
      const FRONTEND_URL = window.location.origin;
      const cardsHtml = await Promise.all(filteredTags.map(async c => {
        const url = await QRCode.toDataURL(`${FRONTEND_URL}/t/${c.qr_token}`, { margin: 1 });
        return `
          <div class="card">
            <img src="${url}" />
            <div class="code">Code ${c.tag_code}</div>
          </div>
        `;
      }));
      const fullHtml = `
        <html>
          <head>
            <title>Print Smart Tags</title>
            <style>
              body { font-family: sans-serif; padding: 20px; }
              .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 20px; }
              .card { border: 1px solid #ccc; padding: 15px; text-align: center; border-radius: 8px; page-break-inside: avoid; }
              img { max-width: 150px; height: auto; }
              .code { font-size: 24px; font-weight: bold; margin-top: 10px; }
            </style>
          </head>
          <body>
            <h2>Smart Tags</h2>
            <div class="grid">${cardsHtml.join('')}</div>
            <script>window.onload = () => window.print();</script>
          </body>
        </html>
      `;
      const w = window.open("", "_blank");
      if (!w) {
        toast.error("Popup blocked — please allow popups for this site and try again.", { id: "print-all" });
        return;
      }
      w.document.write(fullHtml);
      w.document.close();
      toast.success("Done", { id: "print-all" });
    } catch (err) {
      toast.error("Failed to generate print view", { id: "print-all" });
    }
  };

  return (
    <SuperLayout title="Smart Tags">
      <div className="flex flex-col gap-6 max-w-7xl mx-auto pb-12">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <div>
            <h1 className="text-2xl font-bold font-heading text-[#0F2044] mb-1">Smart Contact Tags</h1>
            <p className="text-sm text-gray-500">Generate and manage global Smart Contact Tags.</p>
          </div>
          
          <form onSubmit={handleGenerate} className="flex items-center gap-3 bg-gray-50 p-2 rounded-xl border border-gray-100">
            <input 
              type="number" 
              min="1" 
              max="500" 
              value={generateQuantity}
              onChange={e => setGenerateQuantity(e.target.value)}
              className="w-20 px-3 py-2 border border-gray-200 rounded-lg text-sm text-center focus:outline-none focus:border-[#1A3C6E]"
              disabled={generating}
            />
            <button 
              type="submit" 
              disabled={generating}
              className="px-4 py-2 bg-[#0F2044] text-white rounded-lg text-sm font-bold disabled:opacity-50 hover:bg-[#1A3C6E] transition-colors whitespace-nowrap"
            >
              {generating ? "Generating..." : "Generate Tags"}
            </button>
          </form>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col min-h-[500px]">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
            <div>
              <h2 className="font-heading text-lg font-semibold text-[#0F2044]">Tag Pool</h2>
              <p className="text-sm text-gray-500">
                {filteredTags.length} of {tags.length} total generated
              </p>
            </div>
            
            <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
              <div className="relative flex-1 sm:flex-none">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by tag code or vehicle number..."
                  className="w-full sm:w-64 pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1A3C6E]/20 focus:border-[#1A3C6E]"
                />
              </div>
              <button
                onClick={handlePrintAll}
                className="px-4 py-2 bg-[#0F2044] text-white rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-[#1A3C6E] transition-colors whitespace-nowrap"
              >
                <Download className="w-4 h-4" /> Print All
              </button>
            </div>
          </div>

          <div className="p-6 flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-40">
                <div className="w-8 h-8 border-4 border-[#0F2044]/20 border-t-[#0F2044] rounded-full animate-spin"></div>
              </div>
            ) : filteredTags.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-gray-500">
                <QrCode className="w-12 h-12 mb-2 text-gray-300" />
                <p>No Smart Tags found.</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
                  {paginatedTags.map(tag => (
                    <div key={tag.id} className="relative border rounded-xl p-3 flex flex-col items-center shadow-sm bg-white border-gray-100">
                      <button
                        onClick={() => downloadCardPng(tag)}
                        className="absolute top-2 right-2 p-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-600 transition-colors z-10"
                        title="Download PNG"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <div
                        className="mb-4 mt-2 cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => setZoomedCard(tag)}
                      >
                        {tag.status === "ASSIGNED" ? (
                          <div className="relative">
                            <div className="grayscale opacity-40">
                              <QRCodeSVG value={`${window.location.origin}/t/${tag.qr_token}`} size={84} />
                            </div>
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                              <span className="text-xs font-bold text-white bg-blue-500 px-2 py-0.5 rounded">
                                Assigned
                              </span>
                            </div>
                          </div>
                        ) : (
                          <QRCodeSVG value={`${window.location.origin}/t/${tag.qr_token}`} size={84} />
                        )}
                      </div>
                      <div className="text-xl font-bold font-heading text-[#0F2044] mb-2">
                        Code {tag.tag_code}
                      </div>
                      <div className="flex flex-col items-center gap-2">
                        <span className={`px-2 py-1 text-[10px] sm:text-xs font-bold text-white rounded-full ${tag.status === 'ASSIGNED' ? 'bg-blue-500' : 'bg-green-500'}`}>
                          {tag.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                {filteredTags.length > PAGE_SIZE && (
                  <div className="mt-6 flex items-center justify-between border-t border-gray-100 pt-4">
                    <span className="text-sm text-gray-500">
                      Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredTags.length)} of {filteredTags.length}
                    </span>
                    <Pagination currentPage={page} totalItems={filteredTags.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Detail Modal */}
      {zoomedCard && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => setZoomedCard(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl p-8 flex flex-col items-center max-w-sm w-full animate-in fade-in zoom-in duration-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-end w-full mb-2">
              <button onClick={() => setZoomedCard(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <QRCodeSVG value={`${window.location.origin}/t/${zoomedCard.qr_token}`} size={200} />
            
            <div className="text-3xl font-bold font-heading text-[#0F2044] mt-6">
              Code {zoomedCard.tag_code}
            </div>
            
            <div className="w-full mt-6 pt-6 border-t border-gray-100">
              <h3 className="font-bold text-[#0F2044] mb-4">Tag Details</h3>
              {zoomedCard.status === "ASSIGNED" ? (
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Status</span>
                    <span className="font-bold text-blue-600">Assigned</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Owner Name</span>
                    <span className="font-medium">{zoomedCard.owner_name || "-"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Mobile</span>
                    <span className="font-medium">{zoomedCard.owner_mobile || "-"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Email</span>
                    <span className="font-medium">{zoomedCard.owner_email || "-"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Vehicle</span>
                    <span className="font-medium">{zoomedCard.car_numberplate || "-"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Assigned At</span>
                    <span className="font-medium">{zoomedCard.assigned_at ? fmtDateTimeFull(zoomedCard.assigned_at) : "-"}</span>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4 bg-gray-50 rounded-xl">
                  <span className="text-gray-500 font-medium">Not yet assigned</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </SuperLayout>
  );
}
