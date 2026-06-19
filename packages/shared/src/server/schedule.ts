// Vietnam is UTC+7 year-round (no DST). Seller-chosen broadcast times must be interpreted as
// Vietnam wall-clock REGARDLESS of the server's own timezone — the production VPS runs UTC, so the
// naïve `new Date(y, mo, d, h, m)` / `new Date("YYYY-MM-DDTHH:mm")` would schedule 7h late.

export const VN_UTC_OFFSET_MINUTES = 7 * 60;
const VN_OFFSET_MS = VN_UTC_OFFSET_MINUTES * 60 * 1000;

/** A Date whose getUTC* fields equal the current Vietnam wall-clock. */
function nowInVn(nowMs: number): Date {
  return new Date(nowMs + VN_OFFSET_MS);
}

/** Real UTC instant for a Vietnam wall-clock moment. Day overflow (e.g. d+38) rolls over normally. */
function vnWallClockToUtc(y: number, mo: number, d: number, h: number, mi: number, s = 0): Date {
  return new Date(Date.UTC(y, mo, d, h, mi, s, 0) - VN_OFFSET_MS);
}

/**
 * Next occurrence of `sendTime` ("HH:mm", Vietnam time) as a real UTC Date.
 * daily → today if still ahead else tomorrow; weekly → next `repeatDay` (0=Sun … 6=Sat, VN calendar).
 */
export function computeNextVnRunAt(
  sendTime: string,
  frequency: string,
  repeatDay?: number | null,
  nowMs: number = Date.now(),
): Date {
  const [hStr, miStr] = String(sendTime).split(":");
  const h = Number(hStr ?? 0);
  const mi = Number(miStr ?? 0);
  const vn = nowInVn(nowMs);
  const y = vn.getUTCFullYear();
  const mo = vn.getUTCMonth();
  const d = vn.getUTCDate();

  if (frequency === "weekly") {
    const targetDay = repeatDay ?? 1;
    const currentDay = vn.getUTCDay();
    const daysUntil = (targetDay - currentDay + 7) % 7;
    let candidate = vnWallClockToUtc(y, mo, d + daysUntil, h, mi);
    if (candidate.getTime() <= nowMs) {
      candidate = vnWallClockToUtc(y, mo, d + daysUntil + 7, h, mi);
    }
    return candidate;
  }

  let next = vnWallClockToUtc(y, mo, d, h, mi);
  if (next.getTime() <= nowMs) {
    next = vnWallClockToUtc(y, mo, d + 1, h, mi);
  }
  return next;
}

/**
 * Parse a browser `<input type="datetime-local">` value ("YYYY-MM-DDTHH:mm[:ss]") as Vietnam
 * wall-clock and return the real UTC instant. Returns null when unparseable.
 */
export function parseVnWallClock(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(value || ""));
  if (!m) return null;
  return vnWallClockToUtc(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    m[6] ? Number(m[6]) : 0,
  );
}
