import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureSent } from "./email-result";

test("ensureSent: passes when the recipient was accepted", () => {
  assert.doesNotThrow(() => ensureSent({ accepted: ["a@b.com"], rejected: [] }));
});

test("ensureSent: throws when a recipient was rejected", () => {
  assert.throws(() => ensureSent({ accepted: [], rejected: ["a@b.com"] }));
});

test("ensureSent: throws when nothing was accepted (silent no-op send)", () => {
  // The Resend-era bug: a send that delivered to no one must not count as sent.
  assert.throws(() => ensureSent({ accepted: [], rejected: [] }));
});

test("ensureSent: throws when some accepted but some rejected", () => {
  assert.throws(() => ensureSent({ accepted: ["a@b.com"], rejected: ["c@d.com"] }));
});

test("ensureSent: treats missing arrays as zero (throws)", () => {
  assert.throws(() => ensureSent({}));
});
