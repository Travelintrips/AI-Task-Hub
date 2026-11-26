/** Passive AI Core ledger progress is a reported observation, never native completion.
 * No unverified source event (FAILED/COMPLETED/DEPLOYED/etc.) may become 100%.
 * Existing incorrectly reported 100% is clamped on the next source event;
 * this does not mutate historical rows or authorize task completion.
 */
export function passiveBridgeSourceProgress(
  normalizedStatus: string,
  previousProgress: number,
  verifiedFinalAck: boolean,
): number {
  if (normalizedStatus === "COMPLETED" && verifiedFinalAck) return 100;
  const prior = Number.isFinite(previousProgress)
    ? Math.max(0, Math.min(90, Math.trunc(previousProgress)))
    : 0;
  if (normalizedStatus === "COMPLETED") return Math.max(prior, 90);
  if (["FAILED", "BLOCKED", "DEPLOYED", "MERGED"].includes(normalizedStatus)) return prior;
  return Math.max(prior, 25);
}
