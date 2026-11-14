/** Match the explicit DEV hostname already used by the application login. */
export function isVpsStorageDevHost(hostname?: string): boolean {
  const host = hostname ?? (typeof window === "undefined" ? "" : window.location.hostname);
  return host === "dev-ai-task.cstlogistic.co.id";
}
