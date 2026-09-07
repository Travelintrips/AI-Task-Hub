/**
 * Sprint 9D — Conversation Test Suite & AI Quality Gate
 * Page: /conversation-tests
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Play, Plus, Trash2, Edit, RefreshCw, CheckCircle, XCircle,
  AlertTriangle, Shield, ShieldCheck, ShieldOff, Clock, BarChart2,
} from "lucide-react";

const API = "/api";

// ── API helpers ────────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = typeof window !== "undefined"
    ? (localStorage.getItem("ai_task_center_token") ?? "")
    : "";
  const res = await fetch(`${API}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface TestCase {
  id: number;
  testName: string;
  intentCode: string | null;
  scenarioType: string;
  inputMessages: string[];
  expectedIntentCode: string | null;
  expectedIntakeMode: string | null;
  expectedTaskCreated: boolean;
  expectedMiniFormSent: boolean;
  expectedAdminHandoff: boolean;
  expectedMissingFields: string[];
  isCritical: boolean;
  isActive: boolean;
  createdAt: string;
}

interface TestRun {
  id: number;
  runName: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  passRate: number;
  status: "running" | "passed" | "failed" | "partial";
  qualityGatePassed: boolean | null;
  startedAt: string;
  finishedAt: string | null;
}

interface TestResult {
  result: {
    id: number;
    testCaseId: number;
    status: string;
    actualIntentCode: string | null;
    actualIntakeMode: string | null;
    actualTaskCreated: boolean;
    actualMiniFormSent: boolean;
    actualAdminHandoff: boolean;
    actualMissingFields: string[];
    actualReply: string | null;
    actualConfidenceScore: string | null;
    failureReason: string | null;
    durationMs: number | null;
  };
  testCase: TestCase | null;
}

interface LatestGate {
  latestRun: TestRun | null;
  aiProductionMode: string;
}

// ── Status badge helpers ───────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    passed: "bg-green-100 text-green-700 border-green-200",
    failed: "bg-red-100 text-red-700 border-red-200",
    running: "bg-blue-100 text-blue-700 border-blue-200",
    partial: "bg-yellow-100 text-yellow-700 border-yellow-200",
  };
  const label: Record<string, string> = {
    passed: "Lulus", failed: "Gagal", running: "Berjalan", partial: "Sebagian",
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded border ${map[status] ?? "bg-muted text-muted-foreground border-border"}`}>
      {label[status] ?? status}
    </span>
  );
}

function ModeBadge({ mode }: { mode: string }) {
  if (mode === "production") return <Badge className="bg-green-600 text-white">Produksi</Badge>;
  if (mode === "test") return <Badge className="bg-blue-600 text-white">Test</Badge>;
  return <Badge variant="secondary">Nonaktif</Badge>;
}

// ── Test Case Form ─────────────────────────────────────────────────────────────

interface CaseFormState {
  testName: string;
  intentCode: string;
  scenarioType: string;
  inputMessages: string;
  expectedIntentCode: string;
  expectedIntakeMode: string;
  expectedTaskCreated: boolean;
  expectedMiniFormSent: boolean;
  expectedAdminHandoff: boolean;
  expectedMissingFields: string;
  isCritical: boolean;
  isActive: boolean;
}

const DEFAULT_FORM: CaseFormState = {
  testName: "",
  intentCode: "",
  scenarioType: "normal",
  inputMessages: "",
  expectedIntentCode: "",
  expectedIntakeMode: "continue_collecting",
  expectedTaskCreated: false,
  expectedMiniFormSent: false,
  expectedAdminHandoff: false,
  expectedMissingFields: "",
  isCritical: false,
  isActive: true,
};

function caseToForm(tc: TestCase): CaseFormState {
  return {
    testName: tc.testName,
    intentCode: tc.intentCode ?? "",
    scenarioType: tc.scenarioType,
    inputMessages: (tc.inputMessages ?? []).join("\n"),
    expectedIntentCode: tc.expectedIntentCode ?? "",
    expectedIntakeMode: tc.expectedIntakeMode ?? "continue_collecting",
    expectedTaskCreated: tc.expectedTaskCreated,
    expectedMiniFormSent: tc.expectedMiniFormSent,
    expectedAdminHandoff: tc.expectedAdminHandoff,
    expectedMissingFields: (tc.expectedMissingFields ?? []).join(", "),
    isCritical: tc.isCritical,
    isActive: tc.isActive,
  };
}

function formToPayload(f: CaseFormState) {
  return {
    testName: f.testName,
    intentCode: f.intentCode || null,
    scenarioType: f.scenarioType,
    inputMessages: f.inputMessages.split("\n").map((s) => s.trim()).filter(Boolean),
    expectedIntentCode: f.expectedIntentCode || null,
    expectedIntakeMode: f.expectedIntakeMode || null,
    expectedTaskCreated: f.expectedTaskCreated,
    expectedMiniFormSent: f.expectedMiniFormSent,
    expectedAdminHandoff: f.expectedAdminHandoff,
    expectedMissingFields: f.expectedMissingFields.split(",").map((s) => s.trim()).filter(Boolean),
    isCritical: f.isCritical,
    isActive: f.isActive,
  };
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function ConversationTestsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("cases");
  const [caseDialog, setCaseDialog] = useState(false);
  const [editingCase, setEditingCase] = useState<TestCase | null>(null);
  const [form, setForm] = useState<CaseFormState>(DEFAULT_FORM);
  const [selectedRun, setSelectedRun] = useState<number | null>(null);

  const casesQ = useQuery<TestCase[]>({
    queryKey: ["conv-test-cases"],
    queryFn: () => apiFetch("/conversation-tests/cases"),
  });

  const runsQ = useQuery<TestRun[]>({
    queryKey: ["conv-test-runs"],
    queryFn: () => apiFetch("/conversation-tests/runs"),
  });

  const gateQ = useQuery<LatestGate>({
    queryKey: ["conv-test-gate"],
    queryFn: () => apiFetch("/conversation-tests/latest-gate"),
  });

  const resultsQ = useQuery<TestResult[]>({
    queryKey: ["conv-test-results", selectedRun],
    queryFn: () => apiFetch(`/conversation-tests/results/${selectedRun}`),
    enabled: selectedRun !== null,
  });

  const runMut = useMutation({
    mutationFn: () => apiFetch("/conversation-tests/run", {
      method: "POST",
      body: JSON.stringify({ runName: `Run ${new Date().toLocaleString("id-ID")}` }),
    }),
    onSuccess: () => {
      toast({ title: "Test suite selesai", description: "Hasil telah disimpan." });
      queryClient.invalidateQueries({ queryKey: ["conv-test-runs"] });
      queryClient.invalidateQueries({ queryKey: ["conv-test-gate"] });
      setActiveTab("runs");
    },
    onError: (e: Error) => toast({ title: "Gagal menjalankan test", description: e.message, variant: "destructive" }),
  });

  const saveCaseMut = useMutation({
    mutationFn: (payload: ReturnType<typeof formToPayload>) => {
      if (editingCase) {
        return apiFetch(`/conversation-tests/cases/${editingCase.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      }
      return apiFetch("/conversation-tests/cases", { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: () => {
      toast({ title: editingCase ? "Test case diperbarui" : "Test case dibuat" });
      queryClient.invalidateQueries({ queryKey: ["conv-test-cases"] });
      setCaseDialog(false);
      setEditingCase(null);
      setForm(DEFAULT_FORM);
    },
    onError: (e: Error) => toast({ title: "Gagal menyimpan", description: e.message, variant: "destructive" }),
  });

  const deleteCaseMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/conversation-tests/cases/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Test case dihapus" });
      queryClient.invalidateQueries({ queryKey: ["conv-test-cases"] });
    },
    onError: (e: Error) => toast({ title: "Gagal menghapus", description: e.message, variant: "destructive" }),
  });

  const modeMut = useMutation({
    mutationFn: (mode: string) => apiFetch("/conversation-tests/production-mode", {
      method: "PATCH",
      body: JSON.stringify({ mode }),
    }),
    onSuccess: (_, mode) => {
      toast({ title: `Mode AI diubah ke: ${mode}` });
      queryClient.invalidateQueries({ queryKey: ["conv-test-gate"] });
    },
    onError: (e: Error) => toast({ title: "Gagal mengubah mode", description: e.message, variant: "destructive" }),
  });

  function openCreate() {
    setEditingCase(null);
    setForm(DEFAULT_FORM);
    setCaseDialog(true);
  }

  function openEdit(tc: TestCase) {
    setEditingCase(tc);
    setForm(caseToForm(tc));
    setCaseDialog(true);
  }

  const gate = gateQ.data;
  const latestRun = runsQ.data?.[0];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Conversation Test Suite</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Uji perilaku AI sebelum digunakan di produksi
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ModeBadge mode={gate?.aiProductionMode ?? "off"} />
          <Button
            onClick={() => runMut.mutate()}
            disabled={runMut.isPending || (casesQ.data?.length ?? 0) === 0}
          >
            {runMut.isPending ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            Jalankan Semua Test
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground mb-1">Total Test Cases</div>
            <div className="text-2xl font-bold">{casesQ.data?.length ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground mb-1">Pass Rate Terakhir</div>
            <div className={`text-2xl font-bold ${latestRun && latestRun.passRate >= 90 ? "text-green-600" : latestRun ? "text-red-600" : ""}`}>
              {latestRun ? `${latestRun.passRate}%` : "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground mb-1">Status Quality Gate</div>
            <div className="text-lg font-semibold">
              {latestRun?.qualityGatePassed === true && <span className="text-green-600 flex items-center gap-1"><ShieldCheck className="h-4 w-4" />Lulus</span>}
              {latestRun?.qualityGatePassed === false && <span className="text-red-600 flex items-center gap-1"><ShieldOff className="h-4 w-4" />Gagal</span>}
              {!latestRun && <span className="text-muted-foreground flex items-center gap-1"><Shield className="h-4 w-4" />Belum diuji</span>}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground mb-1">Mode AI</div>
            <ModeBadge mode={gate?.aiProductionMode ?? "off"} />
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="cases">Test Cases</TabsTrigger>
          <TabsTrigger value="runs">Test Runs</TabsTrigger>
          <TabsTrigger value="failed">Kasus Gagal</TabsTrigger>
          <TabsTrigger value="gate">Quality Gate</TabsTrigger>
        </TabsList>

        {/* ── Test Cases Tab ── */}
        <TabsContent value="cases" className="mt-4">
          <div className="flex justify-end mb-3">
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" /> Tambah Test Case
            </Button>
          </div>
          {casesQ.isLoading ? (
            <div className="text-center py-12 text-muted-foreground">Memuat...</div>
          ) : (
            <div className="border rounded-lg overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Nama Test</th>
                    <th className="px-3 py-2 text-left">Skenario</th>
                    <th className="px-3 py-2 text-left">Intent</th>
                    <th className="px-3 py-2 text-center">Task?</th>
                    <th className="px-3 py-2 text-center">Handoff?</th>
                    <th className="px-3 py-2 text-center">Kritis</th>
                    <th className="px-3 py-2 text-center">Aktif</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {casesQ.data?.map((tc) => (
                    <tr key={tc.id} className="border-t hover:bg-muted/20">
                      <td className="px-3 py-2 font-medium">{tc.testName}</td>
                      <td className="px-3 py-2">
                        <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{tc.scenarioType}</span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground text-xs">{tc.expectedIntentCode ?? "—"}</td>
                      <td className="px-3 py-2 text-center">
                        {tc.expectedTaskCreated ? <CheckCircle className="h-4 w-4 text-green-500 mx-auto" /> : <XCircle className="h-4 w-4 text-muted-foreground mx-auto" />}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {tc.expectedAdminHandoff ? <CheckCircle className="h-4 w-4 text-orange-500 mx-auto" /> : <XCircle className="h-4 w-4 text-muted-foreground mx-auto" />}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {tc.isCritical ? <AlertTriangle className="h-4 w-4 text-red-500 mx-auto" /> : "—"}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {tc.isActive ? <span className="text-xs text-green-600">Ya</span> : <span className="text-xs text-muted-foreground">Tidak</span>}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1 justify-end">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(tc)}>
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={() => deleteCaseMut.mutate(tc.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {casesQ.data?.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  Belum ada test case. Klik "Tambah Test Case" atau jalankan migrasi seed.
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* ── Test Runs Tab ── */}
        <TabsContent value="runs" className="mt-4">
          <div className="space-y-3">
            {runsQ.isLoading ? (
              <div className="text-center py-12 text-muted-foreground">Memuat...</div>
            ) : runsQ.data?.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                Belum ada test run. Klik "Jalankan Semua Test" untuk memulai.
              </div>
            ) : (
              runsQ.data?.map((run) => (
                <Card
                  key={run.id}
                  className={`cursor-pointer hover:border-primary transition-colors ${selectedRun === run.id ? "border-primary ring-1 ring-primary" : ""}`}
                  onClick={() => { setSelectedRun(run.id); setActiveTab("failed"); }}
                >
                  <CardContent className="py-3 px-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">{run.runName}</div>
                        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                          <Clock className="h-3 w-3" />
                          {new Date(run.startedAt).toLocaleString("id-ID")}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className={`text-lg font-bold ${run.passRate >= 90 ? "text-green-600" : "text-red-600"}`}>
                            {run.passRate}%
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {run.passedCases}/{run.totalCases} lulus
                          </div>
                        </div>
                        <StatusBadge status={run.status} />
                        {run.qualityGatePassed === true && <ShieldCheck className="h-5 w-5 text-green-500" />}
                        {run.qualityGatePassed === false && <ShieldOff className="h-5 w-5 text-red-500" />}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        {/* ── Failed Cases Tab ── */}
        <TabsContent value="failed" className="mt-4">
          {!selectedRun ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              Pilih test run dari tab "Test Runs" untuk melihat hasil detail.
            </div>
          ) : resultsQ.isLoading ? (
            <div className="text-center py-12 text-muted-foreground">Memuat hasil...</div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium">
                  Hasil Run #{selectedRun}
                </div>
                <div className="flex gap-2 text-xs">
                  <span className="text-green-600 font-medium">
                    ✓ {resultsQ.data?.filter((r) => r.result.status === "passed").length} lulus
                  </span>
                  <span className="text-red-600 font-medium">
                    ✗ {resultsQ.data?.filter((r) => r.result.status === "failed").length} gagal
                  </span>
                </div>
              </div>
              {resultsQ.data?.map((item) => (
                <div
                  key={item.result.id}
                  className={`border rounded-lg p-3 text-sm ${item.result.status === "passed" ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 font-medium">
                        {item.result.status === "passed"
                          ? <CheckCircle className="h-4 w-4 text-green-500" />
                          : <XCircle className="h-4 w-4 text-red-500" />}
                        {item.testCase?.testName ?? `Case #${item.result.testCaseId}`}
                        {item.testCase?.isCritical && <AlertTriangle className="h-3.5 w-3.5 text-red-500" aria-label="Kritis" />}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground space-y-0.5">
                        <div>Intent aktual: <span className="font-mono">{item.result.actualIntentCode ?? "—"}</span></div>
                        <div>Mode intake: <span className="font-mono">{item.result.actualIntakeMode ?? "—"}</span></div>
                        <div>Confidence: <span className="font-mono">{item.result.actualConfidenceScore ?? "—"}</span></div>
                        {item.result.actualReply && (
                          <div className="mt-1 p-2 bg-white/70 rounded border text-xs">
                            <span className="font-medium text-foreground">Balasan AI:</span> {item.result.actualReply}
                          </div>
                        )}
                        {item.result.failureReason && (
                          <div className="mt-1 text-red-700 font-medium">
                            ✗ {item.result.failureReason}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground shrink-0">
                      {item.result.durationMs ? `${item.result.durationMs}ms` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Quality Gate Tab ── */}
        <TabsContent value="gate" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Quality Gate Rules
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                Pass rate minimal 90%
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                Tidak ada skenario kritis yang gagal
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                Tidak ada task dibuat sebelum data lengkap
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                Semua skenario low-confidence wajib tanya klarifikasi atau handoff
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                Mode produksi hanya bisa diaktifkan jika gate lulus
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart2 className="h-5 w-5" />
                Status Terkini
              </CardTitle>
            </CardHeader>
            <CardContent>
              {gateQ.isLoading ? (
                <div className="text-muted-foreground text-sm">Memuat...</div>
              ) : gate?.latestRun ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="text-center">
                      <div className={`text-3xl font-bold ${gate.latestRun.passRate >= 90 ? "text-green-600" : "text-red-600"}`}>
                        {gate.latestRun.passRate}%
                      </div>
                      <div className="text-xs text-muted-foreground">Pass Rate</div>
                    </div>
                    <div className="text-center">
                      <div className="text-3xl font-bold text-green-600">{gate.latestRun.passedCases}</div>
                      <div className="text-xs text-muted-foreground">Lulus</div>
                    </div>
                    <div className="text-center">
                      <div className="text-3xl font-bold text-red-600">{gate.latestRun.failedCases}</div>
                      <div className="text-xs text-muted-foreground">Gagal</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    {gate.latestRun.qualityGatePassed
                      ? <span className="flex items-center gap-1 text-green-700 font-medium"><ShieldCheck className="h-4 w-4" />Quality gate LULUS — mode produksi tersedia</span>
                      : <span className="flex items-center gap-1 text-red-700 font-medium"><ShieldOff className="h-4 w-4" />Quality gate GAGAL — mode produksi diblokir</span>}
                  </div>
                </div>
              ) : (
                <div className="text-muted-foreground text-sm py-4 text-center">
                  Belum ada test run yang selesai.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Mode AI Production</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Atur mode AI. Mode produksi hanya bisa diaktifkan jika quality gate terakhir lulus.
              </p>
              <div className="flex gap-2 flex-wrap">
                {["off", "test", "production"].map((mode) => (
                  <Button
                    key={mode}
                    variant={gate?.aiProductionMode === mode ? "default" : "outline"}
                    size="sm"
                    onClick={() => modeMut.mutate(mode)}
                    disabled={modeMut.isPending}
                  >
                    {mode === "off" && <ShieldOff className="h-4 w-4 mr-1" />}
                    {mode === "test" && <Shield className="h-4 w-4 mr-1" />}
                    {mode === "production" && <ShieldCheck className="h-4 w-4 mr-1" />}
                    {mode === "off" ? "Nonaktif" : mode === "test" ? "Mode Test" : "Mode Produksi"}
                  </Button>
                ))}
              </div>
              <div className="text-xs text-muted-foreground space-y-1 mt-2 p-3 bg-muted/50 rounded">
                <div><strong>Nonaktif:</strong> AI tidak membalas otomatis</div>
                <div><strong>Mode Test:</strong> AI berjalan tapi tidak kirim WA atau buat task nyata</div>
                <div><strong>Mode Produksi:</strong> AI kirim WA dan buat task (butuh quality gate lulus)</div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Case Dialog ── */}
      <Dialog open={caseDialog} onOpenChange={setCaseDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingCase ? "Edit Test Case" : "Tambah Test Case"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nama Test *</Label>
              <Input
                value={form.testName}
                onChange={(e) => setForm((f) => ({ ...f, testName: e.target.value }))}
                placeholder="Contoh: Trucking - pesan singkat tanpa data"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tipe Skenario</Label>
                <Select value={form.scenarioType} onValueChange={(v) => setForm((f) => ({ ...f, scenarioType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="complete">Lengkap</SelectItem>
                    <SelectItem value="low_confidence">Low Confidence</SelectItem>
                    <SelectItem value="cancellation">Pembatalan</SelectItem>
                    <SelectItem value="angry">Pelanggan Marah</SelectItem>
                    <SelectItem value="dg_goods">Barang Berbahaya</SelectItem>
                    <SelectItem value="complaint">Keluhan</SelectItem>
                    <SelectItem value="finance">Keuangan</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Intent Code (opsional)</Label>
                <Input
                  value={form.intentCode}
                  onChange={(e) => setForm((f) => ({ ...f, intentCode: e.target.value }))}
                  placeholder="trucking_inquiry"
                />
              </div>
            </div>
            <div>
              <Label>Pesan Input (satu per baris)</Label>
              <Textarea
                value={form.inputMessages}
                onChange={(e) => setForm((f) => ({ ...f, inputMessages: e.target.value }))}
                placeholder="Saya mau pengiriman trucking"
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Expected Intent Code</Label>
                <Input
                  value={form.expectedIntentCode}
                  onChange={(e) => setForm((f) => ({ ...f, expectedIntentCode: e.target.value }))}
                  placeholder="trucking_inquiry"
                />
              </div>
              <div>
                <Label>Expected Intake Mode</Label>
                <Select value={form.expectedIntakeMode} onValueChange={(v) => setForm((f) => ({ ...f, expectedIntakeMode: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="continue_collecting">Masih kumpulkan data</SelectItem>
                    <SelectItem value="ready_for_task">Siap buat task</SelectItem>
                    <SelectItem value="cancelled">Dibatalkan</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Expected Missing Fields (pisahkan dengan koma)</Label>
              <Input
                value={form.expectedMissingFields}
                onChange={(e) => setForm((f) => ({ ...f, expectedMissingFields: e.target.value }))}
                placeholder="pickup_location, destination, cargo_type"
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              {(
                [
                  ["expectedTaskCreated", "Task Dibuat?"],
                  ["expectedMiniFormSent", "Mini Form Dikirim?"],
                  ["expectedAdminHandoff", "Admin Handoff?"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="flex items-center gap-2">
                  <Switch
                    checked={form[key]}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, [key]: v }))}
                  />
                  <Label className="text-sm">{label}</Label>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.isCritical}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, isCritical: v }))}
                />
                <Label className="text-sm">Skenario Kritis</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.isActive}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
                />
                <Label className="text-sm">Aktif</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCaseDialog(false); setEditingCase(null); }}>
              Batal
            </Button>
            <Button
              onClick={() => saveCaseMut.mutate(formToPayload(form))}
              disabled={!form.testName || saveCaseMut.isPending}
            >
              {saveCaseMut.isPending ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
