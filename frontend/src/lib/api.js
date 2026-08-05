import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api/v1`;
// Use /api/v1 prefixed websocket paths so Kubernetes ingress proxies them.
export const WS_BASE = `${BACKEND_URL.replace(/^http/, "ws")}/api/v1`;

export const api = axios.create({ baseURL: API });

api.interceptors.request.use((config) => {
  const path = window.location.pathname;
  const tokenKey = path.startsWith("/provider") ? "owner_token" : "superadmin_token";
  const t = localStorage.getItem(tokenKey);
  if (t) {
    config.headers.Authorization = `Bearer ${t}`;
    api.defaults.headers.common.Authorization = `Bearer ${t}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      const path = window.location.pathname;
      const isOwner = path.startsWith("/provider");
      
      if (isOwner) {
        localStorage.removeItem("owner_token");
        localStorage.removeItem("owner_name");
        if (path !== "/provider/login") {
          window.location.href = "/provider/login";
        }
      } else {
        localStorage.removeItem("superadmin_token");
        if (path.startsWith("/superadmin") && path !== "/superadmin/login") {
          window.location.href = "/superadmin/login";
        }
      }
    }
    return Promise.reject(err);
  }
);

export function decodeJwt(token) {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch { return null; }
}
