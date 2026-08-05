const IST = { timeZone: "Asia/Kolkata" };

export const fmtTime = (iso) => {
  if (!iso) return "—";
  const utcStr = iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z';
  return new Date(utcStr).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", ...IST });
};

export const fmtDate = (iso) => {
  if (!iso) return "—";
  const utcStr = iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z';
  return new Date(utcStr).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", ...IST });
};

export const fmtDateTime = (iso) => {
  if (!iso) return "—";
  const utcStr = iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z';
  return new Date(utcStr).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", ...IST });
};

export const fmtDateTimeFull = (iso) => {
  if (!iso) return "—";
  const utcStr = iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z';
  return new Date(utcStr).toLocaleString("en-IN", { ...IST });
};
