/**
 * Sprint 10A-1 — Shared types for WA command handlers
 */

import type { ResolvedUser } from "../wa-role-resolver";

export interface WaCommandContext {
  /** Raw incoming text, trimmed, uppercase */
  rawText: string;
  /** Parsed command keyword (e.g. "BBM", "STATUS", "DAFTAR VENDOR") */
  command: string;
  /** Positional args after the command keyword */
  args: string[];
  /** Everything after command as a raw string */
  rawArgs: string;
  /** Sender phone (normalized) */
  phone: string;
  /** Resolved user/role info */
  user: ResolvedUser;
  /** Company context */
  companyId: string;
}

export interface WaCommandResult {
  /** Reply text to send back via WhatsApp */
  reply: string;
  /** Whether the command was handled (true = skip AI detection) */
  handled: boolean;
}
