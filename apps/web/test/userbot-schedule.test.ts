import assert from "node:assert/strict";
import { toUserbotScheduleIso } from "../src/lib/userbot-schedule";

const previousTz = process.env.TZ;
try {
  process.env.TZ = "Asia/Ho_Chi_Minh";
  assert.equal(toUserbotScheduleIso(true, "2026-09-09T20:30", 0), "2026-09-09T13:30:00.000Z");
  process.env.TZ = "UTC";
  assert.equal(toUserbotScheduleIso(true, "2026-09-09T20:30", 0), "2026-09-09T20:30:00.000Z");
  assert.equal(toUserbotScheduleIso(false, ""), undefined);
  assert.throws(() => toUserbotScheduleIso(true, "", 0));
  assert.throws(() => toUserbotScheduleIso(true, "invalid", 0));
  assert.throws(() => toUserbotScheduleIso(true, "2026-09-09T20:30", Date.parse("2026-09-10T00:00Z")));
} finally {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
}
console.log("userbot schedule timezone tests passed");
