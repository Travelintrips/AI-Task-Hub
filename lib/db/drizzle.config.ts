import { defineConfig } from "drizzle-kit";
import path from "path";

const isProduction = process.env.NODE_ENV === "production";
const databaseEnvName = isProduction
  ? "SUPABASE_DATABASE_URL"
  : "SUPABASE_DATABASE_URL_DEV";
const rawUrl = process.env[databaseEnvName]?.trim();

if (!rawUrl) {
  throw new Error(`${databaseEnvName} must be set.`);
}

let url = rawUrl
  .replace(":6543/", ":5432/")
  .replace(":6543?", ":5432?");

if (!url.includes("sslmode=")) {
  url += (url.includes("?") ? "&" : "?") + "sslmode=require";
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: { url },
});
