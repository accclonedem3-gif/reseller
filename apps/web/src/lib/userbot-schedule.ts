export function toUserbotScheduleIso(enabled: boolean, value: string, now = Date.now()) {
  if (!enabled) return undefined;
  const scheduledAt = new Date(value);
  if (!value || Number.isNaN(scheduledAt.getTime())) {
    throw new Error("Vui lòng chọn thời gian hẹn hợp lệ.");
  }
  if (scheduledAt.getTime() <= now) {
    throw new Error("Thời gian hẹn phải ở tương lai.");
  }
  return scheduledAt.toISOString();
}
