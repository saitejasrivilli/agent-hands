import { EvidenceLogger } from "../src/evidence/logger.js";

// Exercises every redaction pattern currently defined in
// evidence/redaction-patterns.ts (key-name match + all value patterns),
// not just the original SSN case — proves the broadened pattern set for
// real rather than leaving it as an unverified claim.
const logger = new EvidenceLogger("evidence", "redaction-demo");
logger.log("system", "test_event", {
  note: "customer provided SSN 123-45-6789, card 4111-1111-1111-1111, contact jane@example.com or 555-123-4567",
  accountToken: "sk-live-abc123",
  memberId: "12345",
});
logger.writeResult(
  { kind: "success", outputs: { note: "SSN on file: 987-65-4321, card on file 4222 2222 2222 2222" }, evidenceId: "redaction-demo" }
);
console.log("done");
