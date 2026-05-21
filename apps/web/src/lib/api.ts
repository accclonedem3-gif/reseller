import axios from "axios";

function resolveApiBaseUrl() {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  if (typeof window !== "undefined") {
    const { hostname, protocol } = window.location;

    if (!["localhost", "127.0.0.1"].includes(hostname)) {
      const rootHost = hostname.replace(/^www\./, "").replace(/^app\./, "");
      return `${protocol}//api.${rootHost}/api/v1`;
    }
  }

  return "http://localhost:3000/api/v1";
}

const api = axios.create({
  baseURL: resolveApiBaseUrl(),
});

let getAccessToken: () => string | null = () => null;
let refreshAccessToken: (() => Promise<string | null>) | null = null;

export function configureApiAuth(input: {
  getAccessToken: () => string | null;
  refreshAccessToken: () => Promise<string | null>;
}) {
  getAccessToken = input.getAccessToken;
  refreshAccessToken = input.refreshAccessToken;
}

api.interceptors.request.use((config) => {
  const token = getAccessToken();

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as {
      _retry?: boolean;
      url?: string;
      headers: Record<string, string>;
    };
    const requestUrl = originalRequest?.url || "";
    const isAuthRequest =
      requestUrl.includes("/auth/login") ||
      requestUrl.includes("/auth/refresh") ||
      requestUrl.includes("/auth/forgot-password") ||
      requestUrl.includes("/auth/reset-password");

    if (
      error.response?.status === 401 &&
      !isAuthRequest &&
      !originalRequest?._retry &&
      refreshAccessToken
    ) {
      originalRequest._retry = true;
      const nextToken = await refreshAccessToken();

      if (nextToken) {
        originalRequest.headers = originalRequest.headers || {};
        originalRequest.headers.Authorization = `Bearer ${nextToken}`;
        return api(originalRequest);
      }
    }

    throw error;
  },
);

export { api };
