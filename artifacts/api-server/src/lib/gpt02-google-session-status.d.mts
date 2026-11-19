export type Gpt02GoogleSessionStatus =
  | "SIGNED_SESSION_GOOGLE_PROOF_FRESH"
  | "SIGNED_SESSION_GOOGLE_CLAIMS_ABSENT"
  | "SIGNED_SESSION_GOOGLE_PROOF_EXPIRED"
  | "SIGNED_SESSION_GOOGLE_PROOF_INVALID"
  | "DEV_SESSION_GUARD_CONFIGURATION_UNAVAILABLE"
  | "SUPER_ADMIN_SESSION_REQUIRED";
export function classifyExistingGpt02GoogleAppSession(
  user: {role?:string;authSource?:string;authSupabaseId?:string;authVerifiedAt?:number;
    id?:string|number;email?:string}|null|undefined,
  env?: NodeJS.ProcessEnv,
  nowMs?:number
): Gpt02GoogleSessionStatus;
