import { test } from "node:test";
import assert from "node:assert/strict";
import { timelineSearchPattern } from "./unified-timeline-search.js";

test("blank search preserves full paged timeline", () => {
  assert.equal(timelineSearchPattern("  "), null);
});
test("search recognizes older command identifiers without lossy page filtering", () => {
  assert.equal(timelineSearchPattern("  bridge-command:dc3169f1  "), "%bridge-command:dc3169f1%");
});
test("LIKE metacharacters cannot silently broaden a scoped literal search", () => {
  assert.equal(timelineSearchPattern("job_100%"), String.raw`%job\_100\%%`);
  assert.equal(timelineSearchPattern(String.raw`a\b`), String.raw`%a\\b%`);
});
