/**
 * The production/development entrypoint imports this first to reject the
 * known shared JWT fallback before loading app modules with startup effects.
 * Unit/synthetic test NODE_ENV remains unaffected.
 */
if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "production") {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.trim().length < 32 ||
      secret === "fallback-secret-change-in-production") {
    throw new Error("SESSION_SECRET must be a non-default value of at least 32 characters before the API can start");
  }
}
