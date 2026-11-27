// Retain the existing CST-DEV login overlay's callback recovery in the canonical SPA.
export const CST_DEV_HOST = "dev-ai-task.cstlogistic.co.id";
export type DevGoogleCallback = { accessToken: string | null; error: string | null; code: string | null };
export function isDevGoogleHandoff(host: string, pathname: string): boolean {
  return host === CST_DEV_HOST && (pathname === "/" || pathname === "/login");
}
export function readDevGoogleCallback(host: string, pathname: string, accessToken: string | null, fragmentError: string | null, search: string): DevGoogleCallback | null {
  if (!isDevGoogleHandoff(host, pathname)) return null;
  const query = new URLSearchParams(search);
  const callback = { accessToken, error: fragmentError ?? query.get("error"), code: query.get("code") };
  return callback.accessToken || callback.error || callback.code ? callback : null;
}
export function devGoogleFailureMessage(error: unknown): string {
  const reason = error instanceof Error ? error.message : "";
  return /not registered|unambiguous|canonical google/i.test(reason)
    ? "Akun Google sudah terverifikasi, tetapi tidak cocok dengan profil Admin DEV."
    : /invalid supabase session|verified google account/i.test(reason)
      ? "Sesi Google tidak dapat diverifikasi oleh AI Task Center. Ulangi login Google."
      : "Sesi Google belum berhasil diteruskan ke AI Task Center. Coba kembali melalui tombol Google.";
}
export function devGoogleCallbackErrorMessage(callback: DevGoogleCallback): string {
  return callback.error
    ? "Google membatalkan atau menolak proses masuk. Silakan ulangi melalui tombol Masuk dengan Google."
    : "Google mengembalikan kode login yang tidak didukung. Gunakan kembali tombol Masuk dengan Google.";
}
