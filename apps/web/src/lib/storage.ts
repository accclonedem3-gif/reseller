const STORAGE_KEY = "reseller-platform-session";

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    recoveryEmail: string | null;
    role: string;
    displayName: string | null;
    sellerId: string | null;
    sellerTier: "free" | "pro" | "ultra" | null;
    sellerTierStartedAt: string | null;
    sellerTierExpiresAt: string | null;
    sellerStatus: string | null;
    sellerCapabilities: string[];
    sellerReadOnly: boolean;
    referralCode?: string | null;
    hasReferrer?: boolean;
    referrer?: { referralCode: string | null; displayName: string | null } | null;
  };
}

export function getStoredSession(): StoredSession | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

export function setStoredSession(value: StoredSession | null) {
  if (!value) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}
