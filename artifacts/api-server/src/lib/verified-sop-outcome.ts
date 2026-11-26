/** Fail closed when a purportedly completed DEV SOP explicitly reports a blocker. */
export function hasExplicitSopFailure(message: string): boolean {
  return /(?:^|\n)\s*(?:\*\*)?BLOCKER\b|(?:^|\n)\s*[-*]?\s*(?:\*\*)?(?:E2E_VERIFIED|FINAL_ACK_VERIFIED)(?:\*\*)?\s*:\s*(?:\*\*)?FALSE\b/im.test(message);
}
