#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: CC0-1.0

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const documentationPath = fileURLToPath(
  new URL("../docs/scripts/CHECK_CONFLICT_MARKERS.md", import.meta.url),
);
const conflictMarkerPattern = /^(?:<<<<<<< |=======(?: |$)|>>>>>>> )/u;

function conflictMarkerLines(source) {
  return source.split(/\r?\n/u).flatMap((line, index) =>
    conflictMarkerPattern.test(line) ? [index + 1] : [],
  );
}

test("accepts the documented conflict-marker example", () => {
  const documentation = readFileSync(documentationPath, "utf8");

  assert.deepEqual(conflictMarkerLines(documentation), []);
});

test("detects real unindented conflict markers", () => {
  const unresolvedConflict =
    [
      ["<<<<<<<", "HEAD"].join(" "),
      "current branch",
      "=======",
      "incoming branch",
      [">>>>>>>", "feature-branch"].join(" "),
    ].join("\n") + "\n";

  assert.deepEqual(conflictMarkerLines(unresolvedConflict), [1, 3, 5]);
});

test("detects an unterminated separator marker", () => {
  assert.deepEqual(conflictMarkerLines("======="), [1]);
});
