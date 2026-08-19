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

export const fmtDuration = (mins) => {
  if (mins == null || isNaN(mins)) return "—";
  const m = Math.max(0, Math.floor(mins));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return `${h}h ${rem}m`;
};
