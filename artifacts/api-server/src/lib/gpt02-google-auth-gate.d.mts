export interface Gpt02GoogleUserCandidate {
  id?: number | string;
  email?: string;
  role?: string;
  authSource?: string;
  authSupabaseId?: string;
  authVerifiedAt?: number;
}
export const GPT02_GOOGLE_OPERATOR_MAX_AGE_MS: number;
export function hasRecentVerifiedGpt02DevGoogleOperator(
  user: Gpt02GoogleUserCandidate | null | undefined,
  env?: NodeJS.ProcessEnv,
  nowMs?: number
): boolean;
