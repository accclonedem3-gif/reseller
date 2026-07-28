import assert from "node:assert/strict";
import test from "node:test";

import {
  hasValidCustomerEmailList,
  parseCustomerEmailList,
} from "../src/lib/customer-email-list";

test("counts one normalized customer email per non-empty line", () => {
  const parsed = parseCustomerEmailList(" User1@Gmail.com \n\nuser2@gmail.com\r\n");

  assert.deepEqual(parsed.emails, ["user1@gmail.com", "user2@gmail.com"]);
  assert.equal(parsed.nonEmptyLineCount, 2);
  assert.equal(hasValidCustomerEmailList(parsed), true);
});

test("rejects malformed and duplicate customer email lines", () => {
  const parsed = parseCustomerEmailList("valid@gmail.com\nnot-an-email\nVALID@gmail.com");

  assert.deepEqual(parsed.invalidLineNumbers, [2]);
  assert.deepEqual(parsed.duplicateEmails, ["valid@gmail.com"]);
  assert.equal(hasValidCustomerEmailList(parsed), false);
});
