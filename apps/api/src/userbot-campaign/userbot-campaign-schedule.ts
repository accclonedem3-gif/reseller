export function parseUserbotCampaignScheduleTime(value?: string): Date | null {
  if (!value) return null;

  const normalized = value.trim();
  if (!normalized) return null;

  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)) {
    throw new Error("Scheduled time must include a timezone offset.");
  }

  const scheduledAt = new Date(normalized);
  if (Number.isNaN(scheduledAt.getTime())) {
    throw new Error("Scheduled time is invalid.");
  }

  return scheduledAt;
}

export function planUserbotCampaignStart(
  scheduleTime: Date | null,
  now = new Date(),
) {
  const scheduledMs = scheduleTime?.getTime() ?? 0;
  const waitForFirstScheduledRun =
    scheduledMs > now.getTime();
  const jobRunAt = waitForFirstScheduledRun ? scheduleTime! : now;

  return {
    delayMs: Math.max(0, jobRunAt.getTime() - now.getTime()),
    jobRunAt,
    nextRunAt: jobRunAt,
  };
}
