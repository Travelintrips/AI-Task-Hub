import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Clock3, Fingerprint, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { getStoredToken } from "@/lib/auth-api";
import {
  getOriginalOwnerLedgerErrorMessage, ORIGINAL_OWNER_CHALLENGE_ID, OWNER_LEDGER_ORIGIN,
  readOriginalOwnerLedger,
} from "@/lib/gpt02-original-owner-ledger";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API_ROOT = `${BASE}/api/gpt02-owner-approval`;
const APPROVAL_UI_ENABLED = (import.meta.env as unknown as Record<string, string | undefined>)
  .VITE_GPT02_OWNER_APPROVAL_ENABLED === "true";
const EXPECTED_OPERATIONS = [
  "DISABLE_ISSUE159_TIMER",
  "SET_EVIDENCE_ROLES_NOLOGIN_LIMIT0_PASSWORD_NULL",
  "SET_AUDITOR_NOLOGIN_LIMIT0_PRESERVE_PASSWORD",
] as const;
const EXPECTED_ROLE_TARGETS = [
  { name: "dev_gpt02_relock_catalog_auditor", canLogin: false, connectionLimit: 0, passwordState: "PRESERVE_PRESENT" },
  { name: "dev_gpt02_attestor_evidence", canLogin: false, connectionLimit: 0, passwordState: "NULL" },
  { name: "dev_gpt02_issuer_evidence", canLogin: false, connectionLimit: 0, passwordState: "NULL" },
  { name: "gpt02_issuer_evidence_reader", canLogin: false, connectionLimit: 0, passwordState: "NULL" },
] as const;

type RoleTarget = {
  name: string;
  canLogin: boolean;
  connectionLimit: number;
  passwordState: "NULL" | "PRESERVE_PRESENT";
};

type RelockManifest = {
  version: number;
  environment: string;
  scope: string;
  projectId: string;
  database: string;
  hostId: string;
  workerPrincipal: string;
  roles: RoleTarget[];
  timer: { unit: string; finalActiveState: string; finalUnitFileState: string };
  service: { unit: string; finalActiveState: string; finalMainPid: number };
  credential: {
    source: string;
    regularFile: boolean;
    symlink: boolean;
    mode: string;
    owner: string;
    group: string;
    contentRead: boolean;
    decrypted: boolean;
  };
  operations: string[];
  preconditions: Record<string, unknown>;
  postconditions: Record<string, unknown>;
  ownerSubject: string;
  ownerEmail: string;
  requestId: string;
  issuedAt: number;
  expiresAt: number;
};

type Challenge = {
  challengeId: string;
  scope: string;
  environment: string;
  manifest: RelockManifest;
  manifestSha256: string;
  approvalMethod: string;
  expiresAt: string;
  ownerApprovalGranted: false;
  executionPermitted: false;
  signingPermitted: false;
  dispatchPermitted: false;
};

type OwnerIdentityReadiness = {
  eligible: true;
  taskId: 183;
  companyId: "default";
  scope: "SUPERADMIN_OWNER_IDENTITY_READ_ONLY";
  ownerSubject: string;
  googleSessionVerified: true;
  enabledOperatorLinkVerified: true;
  approvalDecisionCreated: false;
  cryptographicOwnerSignatureVerified: false;
  issuerAuthorized: false;
  dispatchPermitted: false;
  readOnly: true;
};

type ApprovalReceipt = {
  recorded: true;
  ownerSessionCryptographicallyVerified: true;
  explicitOwnerDecision: "APPROVE";
  executionPermitted: false;
  signingPermitted: false;
  dispatchPermitted: false;
  releaseDecision: "NO_GO";
  manifestSha256: string;
};

class OwnerApprovalHttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "OwnerApprovalHttpError";
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const token = getStoredToken();
  if (!token) throw new Error("Sesi login tidak ditemukan. Masuk kembali dengan Google.");
  const response = await fetch(`${API_ROOT}${path}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) {
    const error = typeof result.error === "string" ? result.error : `HTTP ${response.status}`;
    const message = error.includes("GOOGLE_SESSION_NOT_FRESH")
      ? "Sesi Google Super Admin perlu diperbarui. Keluar lalu masuk kembali dengan Google, kemudian siapkan challenge baru."
      : error.includes("OWNER_IDENTITY_NOT_ELIGIBLE") || error.includes("OWNER_LINK")
        ? "Akun ini belum cocok dengan tautan Owner GPT02 yang aktif. Tidak ada persetujuan yang dicatat."
        : error.includes("OWNER_LINK_VERIFIER_RETIRED")
          ? "Layanan verifikasi tautan Owner GPT02 sedang tidak aktif (410 Gone). Persetujuan belum dapat diterbitkan; jangan mencoba mengulanginya sampai jalur identitas dipulihkan."
          : error.includes("VERIFIER_UNAVAILABLE")
            ? "Pemeriksa identitas CST Hub sedang tidak tersedia. Coba lagi setelah layanan pulih."
            : error;
    throw new OwnerApprovalHttpError(response.status, error, message);
  }
  return result as T;
}

function formatDate(value: string | number): string {
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "medium" });
}

function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm font-medium break-all">{value}</div>
    </div>
  );
}

function isExactGpt02Manifest(challenge: Challenge): boolean {
  const manifest = challenge.manifest;
  const exactRoles = JSON.stringify(manifest.roles) === JSON.stringify(EXPECTED_ROLE_TARGETS);
  const exactOperations = JSON.stringify(manifest.operations) === JSON.stringify(EXPECTED_OPERATIONS);
  const exactCredential = JSON.stringify(manifest.credential) === JSON.stringify({
    source: "/etc/credstore.encrypted/gpt02-issue159-relock-catalog-dsn",
    regularFile: true,
    symlink: false,
    mode: "0600",
    owner: "root",
    group: "root",
    contentRead: false,
    decrypted: false,
  });
  return challenge.scope === "GPT02_RELOCK_CST_DEV" &&
    challenge.environment === "DEV" &&
    manifest.version === 1 &&
    manifest.environment === "DEV" &&
    manifest.scope === "GPT02_RELOCK_CST_DEV" &&
    manifest.projectId === "xssrfshdrtdfupgqwfdw" &&
    manifest.database === "postgres" &&
    manifest.hostId === "srv1792369" &&
    manifest.workerPrincipal === "openclaw-vps-main" &&
    exactRoles && exactOperations && exactCredential &&
    manifest.timer.unit === "gpt02-issue159-relock-catalog-auditor.timer" &&
    manifest.timer.finalActiveState === "inactive" &&
    manifest.timer.finalUnitFileState === "disabled" &&
    manifest.service.unit === "gpt02-issue159-relock-catalog-auditor.service" &&
    manifest.service.finalActiveState === "inactive" &&
    manifest.service.finalMainPid === 0 &&
    manifest.preconditions.rolesFound === 4 &&
    manifest.preconditions.activeSessions === 0 &&
    manifest.preconditions.openWatchdogRows === 0 &&
    manifest.preconditions.serviceIdle === true &&
    manifest.preconditions.noConcurrentSupervisorRun === true &&
    manifest.postconditions.allRoleInvariantsPass === true &&
    manifest.postconditions.activeSessions === 0 &&
    manifest.postconditions.openWatchdogRows === 0 &&
    manifest.postconditions.timerInactiveDisabled === true &&
    manifest.postconditions.serviceIdle === true &&
    manifest.postconditions.credentialMetadataPass === true &&
    manifest.ownerSubject.startsWith("owner:google_") &&
    /^[^@\s]+@[^@\s]+$/.test(manifest.ownerEmail) &&
    Number.isSafeInteger(manifest.issuedAt) &&
    Number.isSafeInteger(manifest.expiresAt) &&
    manifest.expiresAt > Date.now() &&
    manifest.expiresAt - manifest.issuedAt === 120_000 &&
    challenge.expiresAt === new Date(manifest.expiresAt).toISOString() &&
    /^[a-f0-9]{64}$/.test(challenge.manifestSha256) &&
    challenge.approvalMethod === "FRESH_CST_HUB_SIGNED_GOOGLE_OWNER_SESSION" &&
    challenge.ownerApprovalGranted === false &&
    challenge.executionPermitted === false &&
    challenge.signingPermitted === false &&
    challenge.dispatchPermitted === false;
}

function JsonFacts({ title, data }: { title: string; data: Record<string, unknown> }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="rounded-md border bg-muted/30 p-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {Object.entries(data).map(([key, value]) => (
          <KeyValue key={key} label={key} value={String(value)} />
        ))}
      </div>
    </div>
  );
}

export default function Gpt02OwnerApprovalPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [receipt, setReceipt] = useState<ApprovalReceipt | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [checkingIdentity, setCheckingIdentity] = useState(false);
  const [identityReadiness, setIdentityReadiness] = useState<OwnerIdentityReadiness | null>(null);
  const [approving, setApproving] = useState(false);
  const [approvalOutcomeUnknown, setApprovalOutcomeUnknown] = useState(false);
  const [approvalRejected, setApprovalRejected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [readingLedger, setReadingLedger] = useState(false);
  const [ledgerReceipt, setLedgerReceipt] = useState<Awaited<ReturnType<typeof readOriginalOwnerLedger>> | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const ledgerReadGeneration = useRef(0);

  useEffect(() => {
    ledgerReadGeneration.current += 1;
    setLedgerReceipt(null);
    setLedgerError(null);
    setReadingLedger(false);
    return () => { ledgerReadGeneration.current += 1; };
  }, [isAuthenticated, user?.id, user?.role]);

  const readOriginalLedger = async () => {
    if (readingLedger || checkingIdentity || preparing || approving || !isAuthenticated || !user) return;
    const generation = ++ledgerReadGeneration.current;
    setReadingLedger(true);
    setLedgerReceipt(null);
    setLedgerError(null);
    try {
      const result = await readOriginalOwnerLedger({
        origin: window.location.origin,
        role: user.role,
        getToken: getStoredToken,
      });
      if (ledgerReadGeneration.current === generation) setLedgerReceipt(result);
    } catch (cause) {
      if (ledgerReadGeneration.current === generation) setLedgerError(getOriginalOwnerLedgerErrorMessage(cause));
    } finally {
      if (ledgerReadGeneration.current === generation) setReadingLedger(false);
    }
  };

  useEffect(() => {
    if (!challenge || receipt) return;
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(intervalId);
  }, [challenge?.challengeId, receipt]);

  const expiresAtMs = useMemo(() => challenge ? new Date(challenge.expiresAt).getTime() : 0, [challenge]);
  const expired = challenge !== null && expiresAtMs <= nowMs;

  const verifyOwnerIdentity = async () => {
    if (checkingIdentity || preparing || approving || receipt) return;
    setCheckingIdentity(true);
    setIdentityReadiness(null);
    setError(null);
    try {
      const token = getStoredToken();
      if (!token) throw new Error("Sesi login tidak ditemukan. Masuk kembali dengan Google.");
      // Check the signed Google session first. A stale session must not be
      // reported as a broken Owner link. Both requests are strictly GET-only.
      const sessionResponse = await fetch(`${BASE}/api/auth/gpt02/operator-session-readiness`, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (sessionResponse.status === 401) {
        throw new Error("Sesi aplikasi sudah berakhir. Masuk kembali dengan Google.");
      }
      if (!sessionResponse.ok) {
        throw new Error(`Pemeriksaan sesi Google belum berhasil (HTTP ${sessionResponse.status}). Tidak ada approval dibuat.`);
      }
      const session = await sessionResponse.json().catch(() => ({})) as {
        googleProofFresh?: boolean; googleProofStatus?: string;
        requiresFreshGoogleLogin?: boolean; proofSource?: string; readOnly?: boolean;
      };
      if (session.googleProofFresh !== true ||
          session.googleProofStatus !== "SIGNED_SESSION_GOOGLE_PROOF_FRESH" ||
          session.requiresFreshGoogleLogin !== false ||
          session.proofSource !== "signed_app_session" || session.readOnly !== true) {
        throw new Error("Bukti Google pada sesi ini tidak lagi baru. Masuk kembali dengan Google sebelum memeriksa tautan Owner.");
      }
      const response = await fetch(`${BASE}/api/ai-tasks/183/gpt02-owner-identity-readiness?companyId=default`, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      const body = await response.json().catch(() => ({})) as Partial<OwnerIdentityReadiness> & { error?: string };
      if (!response.ok) {
        if (response.status === 401) throw new Error("Sesi aplikasi tidak valid atau sudah berakhir. Keluar lalu masuk kembali menggunakan Google.");
        if (response.status === 403) throw new Error("Sesi Google atau tautan Owner GPT02 tidak cocok. Tidak ada approval yang dibuat.");
        if (response.status === 503) throw new Error("Pemeriksa identitas Owner sedang tidak tersedia. Tidak ada approval yang dibuat.");
        throw new Error(body.error || `Verifikasi identitas gagal (HTTP ${response.status}).`);
      }
      const valid = body.eligible === true &&
        body.taskId === 183 && body.companyId === "default" &&
        body.scope === "SUPERADMIN_OWNER_IDENTITY_READ_ONLY" &&
        typeof body.ownerSubject === "string" && body.ownerSubject.startsWith("owner:google_") &&
        body.googleSessionVerified === true && body.enabledOperatorLinkVerified === true &&
        body.approvalDecisionCreated === false && body.cryptographicOwnerSignatureVerified === false &&
        body.issuerAuthorized === false && body.dispatchPermitted === false && body.readOnly === true;
      if (!valid) throw new Error("Respons readiness Owner tidak sesuai kontrak. Tidak ada approval yang dibuat.");
      setIdentityReadiness(body as OwnerIdentityReadiness);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Verifikasi sesi dan tautan Owner gagal.");
    } finally {
      setCheckingIdentity(false);
    }
  };

  const prepare = async () => {
    if (!APPROVAL_UI_ENABLED || receipt || (challenge && expiresAtMs > Date.now())) return;
    setPreparing(true);
    setError(null);
    setReceipt(null);
    setReviewed(false);
    setApprovalOutcomeUnknown(false);
    setApprovalRejected(false);
    setChallenge(null);
    try {
      const next = await postJson<Challenge>("/prepare", {
        action: "PREPARE_GPT02_RELOCK_OWNER_APPROVAL",
      });
      if (!isExactGpt02Manifest(next)) {
        throw new Error("Manifest yang diterima tidak cocok dengan target tetap GPT02 CST-DEV. Challenge dibuang.");
      }
      setChallenge(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal menyiapkan challenge GPT02.");
    } finally {
      setPreparing(false);
    }
  };

  const approve = async () => {
    if (!APPROVAL_UI_ENABLED || !challenge || !reviewed || expiresAtMs <= Date.now() || receipt) return;
    setApproving(true);
    setError(null);
    try {
      const result = await postJson<ApprovalReceipt>("/approve", {
        challengeId: challenge.challengeId,
        decision: "APPROVE",
        manifestSha256: challenge.manifestSha256,
      });
      if (result.recorded !== true || result.ownerSessionCryptographicallyVerified !== true || result.explicitOwnerDecision !== "APPROVE" ||
          result.manifestSha256 !== challenge.manifestSha256 ||
          result.executionPermitted !== false || result.signingPermitted !== false ||
          result.dispatchPermitted !== false || result.releaseDecision !== "NO_GO") {
        throw new Error("Respons persetujuan tidak sesuai kontrak. Jangan mengulang klik; minta pemeriksaan ledger.");
      }
      setReceipt(result);
      setReviewed(false);
    } catch (cause) {
      // A definitive 4xx response is not an unknown outcome. A timeout,
      // network interruption, or server-side 5xx still needs ledger review.
      const rejected = cause instanceof OwnerApprovalHttpError &&
        [400, 401, 403, 404, 409, 410, 422].includes(cause.status);
      setApprovalRejected(rejected);
      setApprovalOutcomeUnknown(!rejected);
      const message = cause instanceof Error ? cause.message : "Persetujuan Owner gagal.";
      setError(rejected
        ? `Server menolak persetujuan (HTTP ${cause.status}, ${cause.code}): ${message}. Tidak boleh klik ulang pada challenge ini. Perbarui sesi Google jika diperlukan, lalu siapkan challenge baru setelah kedaluwarsa.`
        : `${message} Hasil belum dapat dipastikan. Jangan klik ulang challenge ini; periksa ledger terlebih dahulu.`);
    } finally {
      setApproving(false);
    }
  };

  if (authLoading) {
    return <div className="p-8 text-sm text-muted-foreground">Memeriksa sesi login…</div>;
  }
  if (!isAuthenticated || !user) {
    return <div className="p-8 text-sm text-muted-foreground">Silakan login dengan Google terlebih dahulu.</div>;
  }
  if (user.role !== "super_admin") {
    return (
      <div className="p-8 max-w-3xl mx-auto w-full">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Akses ditolak</AlertTitle>
          <AlertDescription>Halaman persetujuan Owner GPT02 hanya tersedia untuk Super Admin.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-5 md:p-8 max-w-6xl mx-auto w-full space-y-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-primary">
          <ShieldCheck className="h-6 w-6" />
          <span className="text-xs font-semibold uppercase tracking-wider">CST-DEV · Owner control</span>
        </div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Persetujuan Owner GPT02</h1>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Tinjau manifest relock yang spesifik untuk GPT02 CST-DEV. Persetujuan ini terikat ke sesi Google Super Admin CST Hub, challenge 120 detik, dan digest manifest. Ini bukan persetujuan Task #189.
        </p>
      </div>

      <Alert>
        <LockKeyhole className="h-4 w-4" />
        <AlertTitle>Batas kewenangan</AlertTitle>
        <AlertDescription>
          Persetujuan hanya mencatat keputusan Owner. Persetujuan ini tidak mengubah role, timer, service, credential, signer, atau dispatch. Eksekusi tetap <strong>NO-GO</strong> dan memerlukan executor satu-kali yang ditinjau terpisah.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Verifikasi sesi Google dan tautan Owner</CardTitle>
          <CardDescription>
            Pemeriksaan ini hanya mengirim GET ke layanan identitas read-only. Tidak membuat challenge, approval, izin signing, atau dispatch. Bisa dijalankan walaupun fitur persetujuan masih OFF.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-sm text-muted-foreground">Akun aktif: <strong>{user.email}</strong></p>
            <Button variant="outline" onClick={verifyOwnerIdentity} disabled={checkingIdentity || preparing || approving || Boolean(receipt)}>
              <ShieldCheck className={`h-4 w-4 ${checkingIdentity ? "animate-pulse" : ""}`} />
              {checkingIdentity ? "Memverifikasi sesi dan tautan…" : "Verifikasi sesi & tautan Owner"}
            </Button>
          </div>
          {identityReadiness && (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Identitas Owner terverifikasi</AlertTitle>
              <AlertDescription className="space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <KeyValue label="Owner subject" value={identityReadiness.ownerSubject} />
                  <KeyValue label="Scope" value={identityReadiness.scope} />
                  <KeyValue label="Google session verified" value="true" />
                  <KeyValue label="Owner operator link" value="active / matched" />
                  <KeyValue label="Approval decision created" value="false" />
                  <KeyValue label="Signing / dispatch" value="not permitted" />
                </div>
                <p className="text-xs font-medium">Ini hanya hasil pemeriksaan identitas. Tidak ada challenge atau persetujuan Owner yang dibuat.</p>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card data-testid="gpt02-original-owner-ledger">
        <CardHeader>
          <CardTitle className="text-base">Baca keputusan challenge asli</CardTitle>
          <CardDescription>
            Periksa keputusan yang sudah tercatat untuk challenge {ORIGINAL_OWNER_CHALLENGE_ID}. Pemeriksaan ini hanya membaca ledger dan tetap tersedia saat fitur persetujuan baru OFF.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            variant="outline"
            onClick={readOriginalLedger}
            disabled={readingLedger || checkingIdentity || preparing || approving || window.location.origin !== OWNER_LEDGER_ORIGIN}
          >
            <RefreshCw className={`h-4 w-4 ${readingLedger ? "animate-spin" : ""}`} />
            {readingLedger ? "Membaca keputusan asli…" : "Baca keputusan challenge asli"}
          </Button>
          {ledgerError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Keputusan asli belum terverifikasi</AlertTitle>
              <AlertDescription>{ledgerError}</AlertDescription>
            </Alert>
          )}
          {ledgerReceipt && (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Keputusan challenge asli terbaca</AlertTitle>
              <AlertDescription className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <KeyValue label="Challenge ID" value={ledgerReceipt.challengeId} />
                  <KeyValue label="Scope" value={ledgerReceipt.scope} />
                  <KeyValue label="Status / keputusan" value={`${ledgerReceipt.status} / ${ledgerReceipt.decision}`} />
                  <KeyValue label="Waktu keputusan" value={formatDate(ledgerReceipt.decidedAt)} />
                  <KeyValue label="SHA-256 manifest" value={ledgerReceipt.manifestSha256} />
                  <KeyValue label="Baca-saja" value="true" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">Release: {ledgerReceipt.releaseDecision}</Badge>
                  <Badge variant="secondary">Execution: OFF</Badge>
                  <Badge variant="secondary">Signer: OFF</Badge>
                  <Badge variant="secondary">Dispatch: OFF</Badge>
                </div>
                <p className="text-xs">Receipt ini membuktikan keputusan historis. Pemeriksaan ini tidak membuat persetujuan baru atau menjalankan relock.</p>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Siapkan manifest untuk ditinjau</CardTitle>
          <CardDescription>
            Server akan memverifikasi sesi Google yang masih baru dan tautan Owner aktif sebelum menerbitkan challenge. Jika sesi Google sudah kedaluwarsa, login Google kembali dahulu.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="text-sm text-muted-foreground">Akun aktif: <strong>{user.email}</strong></div>
          <Button onClick={prepare} disabled={!APPROVAL_UI_ENABLED || preparing || approving || Boolean(receipt) || Boolean(challenge && !expired)}>
            <RefreshCw className={`h-4 w-4 ${preparing ? "animate-spin" : ""}`} />
            {preparing ? "Memeriksa identitas…" : challenge ? (expired ? "Siapkan challenge baru" : "Challenge sedang berlangsung") : "Siapkan manifest GPT02"}
          </Button>
        </CardContent>
      </Card>

      {!APPROVAL_UI_ENABLED && (
        <Alert>
          <LockKeyhole className="h-4 w-4" />
          <AlertTitle>Form persetujuan belum diaktifkan</AlertTitle>
          <AlertDescription>
            Halaman review sudah tersedia di kode, tetapi tombol persiapan dan persetujuan tetap terkunci sampai endpoint Core-AI DEV dan jalur Nginx kandidat disetujui serta diaktifkan secara terpisah.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Proses dihentikan</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {challenge && (
        <>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-1">
                  <CardTitle className="text-base">3. Manifest yang harus ditinjau</CardTitle>
                  <CardDescription>Semua sasaran dan tindakan berikut terikat ke satu digest yang tidak dapat diubah.</CardDescription>
                </div>
                <Badge variant={receipt ? "default" : expired ? "destructive" : "secondary"}>
                  {receipt ? "APPROVAL TERCATAT" : expired ? "CHALLENGE KEDALUWARSA" : "MENUNGGU OWNER"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <KeyValue label="Scope" value={challenge.manifest.scope} />
                <KeyValue label="Environment" value={challenge.manifest.environment} />
                <KeyValue label="Project" value={challenge.manifest.projectId} />
                <KeyValue label="Host" value={challenge.manifest.hostId} />
                <KeyValue label="Worker" value={challenge.manifest.workerPrincipal} />
                <KeyValue label="Database" value={challenge.manifest.database} />
                <KeyValue label="Owner" value={challenge.manifest.ownerEmail} />
                <KeyValue label="Owner subject" value={challenge.manifest.ownerSubject} />
                <KeyValue label="Request ID" value={challenge.manifest.requestId} />
                <KeyValue label="Challenge ID" value={challenge.challengeId} />
                <KeyValue label="Dibuat" value={formatDate(challenge.manifest.issuedAt)} />
                <KeyValue label="Berlaku sampai" value={`${formatDate(challenge.expiresAt)}${expired ? " · kedaluwarsa" : ` · tersisa ${Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1_000))} detik`}`} />
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Sasaran PostgreSQL (4 role)</h3>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left">
                      <tr><th className="p-3">Role</th><th className="p-3">LOGIN</th><th className="p-3">Connection limit</th><th className="p-3">Password state</th></tr>
                    </thead>
                    <tbody>
                      {challenge.manifest.roles.map((role) => (
                        <tr key={role.name} className="border-t">
                          <td className="p-3 font-mono text-xs">{role.name}</td>
                          <td className="p-3">{role.canLogin ? "true" : "false"}</td>
                          <td className="p-3 tabular-nums">{role.connectionLimit}</td>
                          <td className="p-3 font-mono text-xs">{role.passwordState}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-md border p-4 space-y-2">
                  <h3 className="text-sm font-semibold">Systemd timer</h3>
                  <KeyValue label="Unit" value={challenge.manifest.timer.unit} />
                  <div className="grid grid-cols-2 gap-3">
                    <KeyValue label="Final active state" value={challenge.manifest.timer.finalActiveState} />
                    <KeyValue label="Final unit file state" value={challenge.manifest.timer.finalUnitFileState} />
                  </div>
                </div>
                <div className="rounded-md border p-4 space-y-2">
                  <h3 className="text-sm font-semibold">Systemd service</h3>
                  <KeyValue label="Unit" value={challenge.manifest.service.unit} />
                  <div className="grid grid-cols-2 gap-3">
                    <KeyValue label="Final active state" value={challenge.manifest.service.finalActiveState} />
                    <KeyValue label="Final MainPID" value={challenge.manifest.service.finalMainPid} />
                  </div>
                </div>
              </div>

              <div className="rounded-md border p-4 space-y-2">
                <h3 className="text-sm font-semibold">Kebijakan credential terenkripsi (metadata saja)</h3>
                <KeyValue label="Source" value={challenge.manifest.credential.source} />
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <KeyValue label="Regular file" value={String(challenge.manifest.credential.regularFile)} />
                  <KeyValue label="Symlink" value={String(challenge.manifest.credential.symlink)} />
                  <KeyValue label="Mode" value={challenge.manifest.credential.mode} />
                  <KeyValue label="Owner/group" value={`${challenge.manifest.credential.owner}:${challenge.manifest.credential.group}`} />
                  <KeyValue label="Content read" value={String(challenge.manifest.credential.contentRead)} />
                  <KeyValue label="Decrypted" value={String(challenge.manifest.credential.decrypted)} />
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Operasi yang diizinkan oleh manifest</h3>
                <ol className="list-decimal pl-5 space-y-1 text-sm">
                  {challenge.manifest.operations.map((operation) => <li key={operation} className="font-mono text-xs break-all">{operation}</li>)}
                </ol>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <JsonFacts title="Preconditions wajib" data={challenge.manifest.preconditions} />
                <JsonFacts title="Postconditions wajib" data={challenge.manifest.postconditions} />
              </div>

              <div className="rounded-md border bg-muted/30 p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold"><Fingerprint className="h-4 w-4" /> SHA-256 manifest</div>
                <p className="font-mono text-xs break-all select-all">{challenge.manifestSha256}</p>
                <p className="text-xs text-muted-foreground">Metode autentikasi: {challenge.approvalMethod}</p>
              </div>
            </CardContent>
          </Card>

          {!receipt ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">4. Keputusan Owner</CardTitle>
                <CardDescription>
                  Periksa ulang project, host, empat role, timer/service, operasi, dan semua syarat. Persetujuan hanya berlaku untuk digest di atas dan challenge ini.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {approvalRejected && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Server menolak persetujuan — tidak ada bukti keputusan tercatat</AlertTitle>
                    <AlertDescription>Periksa pesan error di halaman. Jangan ulangi keputusan pada challenge yang sama; gunakan sesi Google baru dan challenge baru setelah challenge lama berakhir.</AlertDescription>
                  </Alert>
                )}
                {approvalOutcomeUnknown && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Hasil persetujuan belum dapat dipastikan</AlertTitle>
                    <AlertDescription>Jangan klik ulang pada challenge ini. Tunggu kedaluwarsa, lalu minta challenge baru setelah status ledger diperiksa.</AlertDescription>
                  </Alert>
                )}
                {expired && (
                  <Alert variant="destructive">
                    <Clock3 className="h-4 w-4" />
                    <AlertTitle>Challenge sudah kedaluwarsa</AlertTitle>
                    <AlertDescription>Siapkan challenge baru dan tinjau ulang seluruh manifest sebelum menyetujui.</AlertDescription>
                  </Alert>
                )}
                <div className="flex items-start gap-3 rounded-md border p-4">
                  <Checkbox id="gpt02-owner-reviewed" checked={reviewed} onCheckedChange={(checked) => setReviewed(checked === true)} disabled={expired || approving} />
                  <label htmlFor="gpt02-owner-reviewed" className="text-sm leading-relaxed cursor-pointer">
                    Saya telah membaca seluruh manifest di atas dan secara eksplisit menyetujui hanya tindakan yang tertera untuk GPT02 CST-DEV, project <strong>xssrfshdrtdfupgqwfdw</strong>, host <strong>srv1792369</strong>, dengan digest yang ditampilkan.
                  </label>
                </div>
                <Button className="w-full sm:w-auto" onClick={approve} disabled={!reviewed || expired || approving || approvalRejected || approvalOutcomeUnknown || Boolean(receipt)}>
                  <ShieldCheck className="h-4 w-4" />
                  {approving ? "Memverifikasi sesi & mencatat keputusan…" : approvalOutcomeUnknown ? "Menunggu pemeriksaan ledger" : approvalRejected ? "Ditolak — siapkan challenge baru" : "APPROVE manifest GPT02 ini"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Sesi Google harus masih baru. Bila pemeriksaan sesi atau tautan Owner gagal, server menolak keputusan dan tidak mencatat approval.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Keputusan Owner tercatat</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>Keputusan <strong>APPROVE</strong> untuk manifest ini telah dicatat dan nonce challenge telah dikonsumsi satu kali.</p>
                <p className="font-mono text-xs break-all">{receipt.manifestSha256}</p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Badge variant="secondary">Release: {receipt.releaseDecision}</Badge>
                  <Badge variant="secondary">Execution: OFF</Badge>
                  <Badge variant="secondary">Signer: OFF</Badge>
                  <Badge variant="secondary">Dispatch: OFF</Badge>
                </div>
                <p className="font-medium">Belum ada perubahan database atau systemd. Jangan menganggap relock selesai; eksekutor satu-kali masih belum tersedia.</p>
              </AlertDescription>
            </Alert>
          )}
        </>
      )}
    </div>
  );
}
