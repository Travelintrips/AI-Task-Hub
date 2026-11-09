/** Preserve the verified login subject without coercing federated IDs into legacy INT audit columns. */
type Principal = { id: unknown; email: unknown; role: unknown };
type ActorIdentity = { version: 1; id: string; email: string; role: "super_admin" };
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
function subject(value: unknown): string | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  return typeof value === "string" && ID.test(value) && value.trim() === value && value !== "0" ? value : null;
}
function email(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 254) return null;
  const normalized = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}
function legacyId(id: string): number | null {
  if (!/^[1-9][0-9]*$/.test(id)) return null;
  const value = Number(id);
  return Number.isSafeInteger(value) && value <= 2147483647 ? value : null;
}
export function createGpt02PicAuditActor(principal: Principal): {
  legacyUserId: number | null; actorIdentity: ActorIdentity;
} {
  const id = subject(principal.id), normalizedEmail = email(principal.email);
  if (!id || !normalizedEmail || principal.role !== "super_admin") throw new Error("GPT02_PIC_ACTOR_INVALID");
  return { legacyUserId: legacyId(id), actorIdentity: { version: 1, id, email: normalizedEmail, role: "super_admin" } };
}
/** Only persisted server-generated audit data. Never use request body identities. */
export function readGpt02PicAuditActor(row: {
  actorId: unknown; actorEmail: unknown; after: unknown;
} | null | undefined): string | null {
  if (!row) return null;
  let payload: unknown;
  try { payload = typeof row.after === "string" ? JSON.parse(row.after) : null; } catch { return null; }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const data = payload as Record<string, unknown>;
  if (!Object.hasOwn(data, "actorIdentity")) {
    return typeof row.actorId === "number" && Number.isInteger(row.actorId) &&
      row.actorId > 0 && row.actorId <= 2147483647 ? String(row.actorId) : null;
  }
  const value = data.actorIdentity;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const actor = value as Record<string, unknown>;
  const id = subject(actor.id), normalizedEmail = email(actor.email), rowEmail = email(row.actorEmail);
  if (Object.keys(actor).sort().join(',') !== 'email,id,role,version' || actor.version !== 1 ||
      actor.role !== 'super_admin' || typeof actor.id !== 'string' || !id || !normalizedEmail ||
      normalizedEmail !== rowEmail || row.actorId !== legacyId(id)) return null;
  return id;
}
