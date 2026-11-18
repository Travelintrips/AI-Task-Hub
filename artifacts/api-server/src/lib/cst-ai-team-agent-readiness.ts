import { aiCoreBridgeConfigured, fetchAiCoreTeamReadinessResponse } from "./ai-core-execution-bridge";

/** Read-only status of existing external workers from the exact DEV AI Core bridge.
 * "Eligible" means fresh heartbeat and healthy registry only. It never proves a
 * task was executed, acknowledged, or verified.
 */
export type CstTeamWorkerPresence = {
  clientId: string;
  eligible: boolean;
  presenceState: "ACTIVE" | "UNAVAILABLE";
  reportedHealth: "healthy" | "degraded" | "unknown";
  lastSeenAt: string | null;
  leaseExpiresAt: string | null;
};
export type CstTeamAgentReadiness = {
  status: "available" | "unavailable";
  mode: "PRESENCE_ONLY_NOT_EXECUTION_PROOF";
  checkedAt: string | null;
  workers: CstTeamWorkerPresence[];
  reason?: "BRIDGE_NOT_CONFIGURED" | "READINESS_SCOPE_NOT_READY" |
    "CORE_READINESS_NOT_DEPLOYED" | "CORE_READINESS_UNAVAILABLE" |
    "CORE_READINESS_INVALID";
};

const READINESS_CLIENTS = new Set([
  "openclaw-vps-main", "openclaw-pc-worker-dev", "openclaw-travelintrips-tools-dev",
]);
const unavailable = (reason: NonNullable<CstTeamAgentReadiness["reason"]>): CstTeamAgentReadiness =>
  ({ status: "unavailable", mode: "PRESENCE_ONLY_NOT_EXECUTION_PROOF",
     checkedAt: null, workers: [], reason });

export async function fetchCstTeamAgentReadiness(): Promise<CstTeamAgentReadiness> {
  if (!aiCoreBridgeConfigured()) return unavailable("BRIDGE_NOT_CONFIGURED");
  try {
    const response = await fetchAiCoreTeamReadinessResponse();
    if (response.status === 404) return unavailable("CORE_READINESS_NOT_DEPLOYED");
    if (response.status === 401 || response.status === 403) return unavailable("READINESS_SCOPE_NOT_READY");
    if (!response.ok) return unavailable("CORE_READINESS_UNAVAILABLE");
    const result: unknown = await response.json();
    if (!result || typeof result !== "object") return unavailable("CORE_READINESS_INVALID");
    const body = result as Record<string, unknown>;
    if (body["schemaVersion"] !== 1 ||
        body["mode"] !== "PRESENCE_ONLY_NOT_EXECUTION_PROOF" ||
        typeof body["checkedAt"] !== "string" ||
        !Array.isArray(body["workers"]) || body["workers"].length !== 3) {
      return unavailable("CORE_READINESS_INVALID");
    }
    const unique = new Set<string>();
    const workers: CstTeamWorkerPresence[] = [];
    for (const item of body["workers"] as unknown[]) {
      if (!item || typeof item !== "object") return unavailable("CORE_READINESS_INVALID");
      const row = item as Record<string, unknown>;
      const id = row["clientId"];
      if (typeof id !== "string" || !READINESS_CLIENTS.has(id) || unique.has(id) ||
          typeof row["eligible"] !== "boolean" ||
          !["ACTIVE", "UNAVAILABLE"].includes(String(row["presenceState"])) ||
          !["healthy", "degraded", "unknown"].includes(String(row["reportedHealth"]))) {
        return unavailable("CORE_READINESS_INVALID");
      }
      unique.add(id);
      workers.push({
        clientId: id,
        eligible: row["eligible"] === true && row["presenceState"] === "ACTIVE" && row["reportedHealth"] === "healthy",
        presenceState: row["presenceState"] as CstTeamWorkerPresence["presenceState"],
        reportedHealth: row["reportedHealth"] as CstTeamWorkerPresence["reportedHealth"],
        lastSeenAt: typeof row["lastSeenAt"] === "string" ? row["lastSeenAt"] : null,
        leaseExpiresAt: typeof row["leaseExpiresAt"] === "string" ? row["leaseExpiresAt"] : null,
      });
    }
    if (unique.size !== READINESS_CLIENTS.size) return unavailable("CORE_READINESS_INVALID");
    return {
      status: "available", mode: "PRESENCE_ONLY_NOT_EXECUTION_PROOF",
      checkedAt: body["checkedAt"], workers,
    };
  } catch {
    return unavailable("CORE_READINESS_UNAVAILABLE");
  }
}
