import { defineConfig } from "drizzle-kit";
import path from "path";

const rawUrl =
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DATABASE_URL ||
  process.env.SUPABASE_DATABASE_URL_DEV;

if (!rawUrl) {
  throw new Error("DATABASE_URL must be set.");
}

// drizzle-kit push needs Session mode (port 5432), not Transaction pooler (6543)
let url = rawUrl
  .replace(":6543/", ":5432/")
  .replace(":6543?", ":5432?");

// Only append sslmode for Supabase URLs; Replit's local Postgres doesn't need it
const isSupabase = url.includes("supabase.co");
const finalUrl = isSupabase && !url.includes("sslmode=")
  ? url + (url.includes("?") ? "&" : "?") + "sslmode=require"
  : url;

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: { url: finalUrl },
});
