import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalizeRoute } from "../src/artifact/route-canonicalization.js";

test("canonicalizeRoute: numeric path segment becomes :id", () => {
  assert.equal(
    canonicalizeRoute("http://localhost:4000/member/12345/new-subaccount"),
    "/member/:id/new-subaccount"
  );
});

test("canonicalizeRoute: numeric query value becomes :paramName", () => {
  assert.equal(canonicalizeRoute("http://localhost:4000/member?memberId=12345"), "/member?memberId=:memberId");
});

test("canonicalizeRoute: non-numeric segments/values pass through unchanged", () => {
  assert.equal(canonicalizeRoute("http://localhost:4000/member/new-subaccount"), "/member/new-subaccount");
});

test("canonicalizeRoute: two different records canonicalize to the same pattern", () => {
  const a = canonicalizeRoute("http://localhost:4000/member/12345/new-subaccount");
  const b = canonicalizeRoute("http://localhost:4000/member/67890/new-subaccount");
  assert.equal(a, b);
});
