// Translates an internal stuck-reason string into a sentence a non-technical
// operator (a bank staff member, not an engineer) can act on immediately,
// without needing to parse a Playwright stack trace. The raw technical
// reason is never hidden — it's still shown alongside, for whoever wants it
// — this is an additional plain-language layer, not a replacement.

export function explainReason(reason: string): string {
  if (/locator_resolution|no locator strategy resolved/i.test(reason)) {
    return "The automation couldn't find a button or field it expected on this page.";
  }
  if (/timeout/i.test(reason)) {
    return "The page took too long to respond (the backend may be slow or unavailable).";
  }
  if (/guardrail_blocked|not in allowlist/i.test(reason)) {
    return "This action was blocked by a safety rule — it wasn't on the approved list.";
  }
  if (/max_steps_exceeded/i.test(reason)) {
    return "The automation ran out of attempts without reaching the goal.";
  }
  if (/model_returned_no_tool_call/i.test(reason)) {
    return "The AI wasn't sure what to do next and stopped rather than guess.";
  }
  return "The automation stopped and needs a person to check what's happening.";
}
