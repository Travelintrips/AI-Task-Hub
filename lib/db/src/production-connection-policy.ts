/**
 * Block the retired admin login on production Supabase endpoints before a pool
 * can retry it. Local PostgreSQL fixtures and non-production selection are unchanged.
 * Parse only identity/host: pg-connection-string can read SSL files while parsing.
 */
export function assertProductionConnectionAllowed(
  connectionString: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.NODE_ENV !== "production" || !connectionString) return;
  // pg treats a leading slash as a local Unix socket path.
  if (connectionString.startsWith("/")) return;

  let user: string | undefined;
  let host: string;
  try {
    // Match pg-connection-string 2.12's normalization before WHATWG URL parsing.
    let value = connectionString;
    if (/ |%[^a-f0-9]|%[a-f0-9][^a-f0-9]/i.test(value)) {
      value = encodeURI(value).replace(/%25(\d\d)/g, "%$1");
    }
    let url: URL;
    let dummyHost = false;
    try {
      url = new URL(value, "postgres://base");
    } catch {
      url = new URL(value.replace("@/", "@___DUMMY___/"), "postgres://base");
      dummyHost = true;
    }
    // For socket: pg overrides any query host with the local socket pathname.
    if (url.protocol === "socket:") return;

    // pg assigns search parameters in order: the last duplicate wins. An empty
    // final value falls back to the authority, then the normal pg environment.
    user = url.searchParams.getAll("user").pop() ||
      decodeURIComponent(url.username) || env.PGUSER ||
      (process.platform === "win32" ? env.USERNAME : env.USER);
    host = url.searchParams.getAll("host").pop() ||
      decodeURIComponent(dummyHost ? "" : url.hostname) || env.PGHOST || "localhost";
  } catch {
    // Never include the URL, user, password, query parameters, or original cause.
    throw new Error("Invalid production database connection configuration.");
  }

  const normalizedHost = host.toLowerCase().replace(/\.$/, "");
  const supabaseHost = normalizedHost === "pooler.supabase.com" ||
    normalizedHost.endsWith(".pooler.supabase.com") ||
    /^db\.[a-z0-9-]+\.supabase\.co$/.test(normalizedHost);
  if (supabaseHost && (user === "postgres" || user?.startsWith("postgres."))) {
    throw new Error("Production Supabase connections require an application login role.");
  }
}
