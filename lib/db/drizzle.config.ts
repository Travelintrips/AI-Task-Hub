import { defineConfig } from "drizzle-kit";
import path from "path";

const rawUrl =
  process.env.SUPABASE_DATABASE_URL ||
  process.env.DATABASE_URL;

if (!rawUrl) {
  throw new Error("SUPABASE_DATABASE_URL (or DATABASE_URL) must be set.");
}

// drizzle-kit push needs Session mode (port 5432), not Transaction pooler (6543)
const url = rawUrl
  .replace(":6543/", ":5432/")
  .replace(":6543?", ":5432?");

// Append sslmode=require if not already present
const finalUrl = url.includes("sslmode=")
  ? url
  : url + (url.includes("?") ? "&" : "?") + "sslmode=require";

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: { url: finalUrl },
});
