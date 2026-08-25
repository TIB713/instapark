export function Pagination({ currentPage, totalItems, pageSize, onPageChange }) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalPages <= 1) return null;

  const getPageNumbers = () => {
    const pages = [];
    const delta = 1; // neighbors to show around current page
    const range = [];
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= currentPage - delta && i <= currentPage + delta)) {
        range.push(i);
      }
    }
    let prev = null;
    for (const p of range) {
      if (prev !== null && p - prev > 1) pages.push("ellipsis-" + p);
      pages.push(p);
      prev = p;
    }
    return pages;
  };

  return (
    <div className="flex items-center gap-2">
      <button
        disabled={currentPage === 1}
        onClick={() => onPageChange(currentPage - 1)}
        className="px-3 py-2 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Prev
      </button>
      {getPageNumbers().map((p, idx) =>
        typeof p === "string" ? (
          <span key={p + idx} className="px-2 text-sm text-gray-400">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            className={`min-w-[40px] px-3 py-2 rounded-xl text-sm font-bold transition-colors ${
              p === currentPage
                ? "bg-[#0F2044] text-white"
                : "border border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {p}
          </button>
        )
      )}
      <button
        disabled={currentPage === totalPages}
        onClick={() => onPageChange(currentPage + 1)}
        className="px-3 py-2 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Next
      </button>
    </div>
  );
}
