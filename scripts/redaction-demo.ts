import { EvidenceLogger } from "../src/evidence/logger.js";

const logger = new EvidenceLogger("evidence", "redaction-demo");
logger.log("system", "test_event", {
  note: "customer provided SSN 123-45-6789 during verification call",
  accountToken: "sk-live-abc123",
  memberId: "12345",
});
logger.writeResult({ kind: "success", outputs: { note: "SSN on file: 987-65-4321" }, evidenceId: "redaction-demo" });
console.log("done");
