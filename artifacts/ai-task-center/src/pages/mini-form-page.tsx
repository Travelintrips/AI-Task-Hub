/**
 * Public Mini Form Page — Sprint 9B
 * Route: /mini-form/:type/:token
 * No authentication required — token-based access
 */

import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `Error ${res.status}`);
  }
  return res.json();
}

interface FieldDef {
  name: string;
  label: string;
  type: "text" | "number" | "date" | "textarea" | "select" | "file";
  required: boolean;
  options?: string[];
  helpText?: string;
  placeholder?: string;
  field_name?: string;
  field_label?: string;
  field_type?: string;
  is_required?: boolean;
  help_text?: string;
  sample_value?: string;
}

interface FormData {
  status: string;
  message?: string;
  intentCode: string;
  intentName?: string;
  category?: string;
  formTitle: string;
  formDescription?: string;
  builtinFields: FieldDef[];
  customFields: FieldDef[];
  collectedFields: Record<string, unknown>;
  missingFields: string[];
  requiredDocuments: string[];
  uploadedDocuments: string[];
}

function normalizeField(f: FieldDef): { name: string; label: string; type: string; required: boolean; options?: string[]; helpText?: string; placeholder?: string } {
  return {
    name: f.name ?? f.field_name ?? "",
    label: f.label ?? f.field_label ?? "",
    type: f.type ?? f.field_type ?? "text",
    required: f.required ?? f.is_required ?? false,
    options: f.options,
    helpText: f.helpText ?? f.help_text,
    placeholder: f.placeholder ?? f.sample_value,
  };
}

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-500">Memuat form...</p>
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 to-orange-50 p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
        <div className="text-4xl mb-4">⚠️</div>
        <h2 className="text-lg font-semibold text-gray-800 mb-2">Form Tidak Tersedia</h2>
        <p className="text-gray-500 text-sm">{message}</p>
      </div>
    </div>
  );
}

function SuccessState({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-emerald-100 p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
        <div className="text-5xl mb-4">✅</div>
        <h2 className="text-xl font-bold text-gray-800 mb-3">Berhasil!</h2>
        <p className="text-gray-600 text-sm leading-relaxed">{message}</p>
        <p className="text-xs text-gray-400 mt-4">Anda dapat menutup halaman ini.</p>
      </div>
    </div>
  );
}

function FormField({
  field,
  value,
  onChange,
  hasError,
}: {
  field: ReturnType<typeof normalizeField>;
  value: string;
  onChange: (v: string) => void;
  hasError: boolean;
}) {
  const base = `w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition ${
    hasError ? "border-red-400 focus:ring-2 focus:ring-red-200" : "border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
  }`;

  if (field.type === "textarea") {
    return (
      <textarea
        className={`${base} h-24 resize-none`}
        placeholder={field.placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (field.type === "select" && field.options) {
    return (
      <select className={base} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— Pilih —</option>
        {field.options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    );
  }
  if (field.type === "file") {
    return (
      <div className="space-y-1">
        <input
          type="file"
          className="w-full text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-600 file:font-medium hover:file:bg-blue-100"
          accept=".jpg,.jpeg,.png,.pdf,.doc,.docx"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onChange(file.name);
          }}
        />
        {field.helpText && <p className="text-xs text-gray-400">{field.helpText}</p>}
      </div>
    );
  }
  return (
    <input
      type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
      className={base}
      placeholder={field.placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export default function MiniFormPage() {
  const params = useParams<{ type?: string; token?: string; templateId?: string }>();
  const type = params.type;
  const token = params.token;
  const templateId = params.templateId;
  const isPreview = !!templateId || type === "preview";
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitResult, setSubmitResult] = useState<{ ok: boolean; message: string; isComplete: boolean; missingFields?: string[] } | null>(null);

  const apiPath = isPreview
    ? `/public/mini-form/preview/${templateId ?? token}`
    : `/public/mini-form/${type}/${token}`;

  const { data, isLoading, error } = useQuery<FormData>({
    queryKey: ["mini-form", isPreview ? `preview-${templateId}` : `${type}-${token}`],
    queryFn: () => apiFetch(apiPath),
    retry: false,
    staleTime: Infinity,
    enabled: isPreview ? !!(templateId || token) : !!(type && token),
  });

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch(`/public/mini-form/${type}/${token}`, {
        method: "POST",
        body: JSON.stringify({
          fields: values,
          submittedBy: "customer",
        }),
      }),
    onSuccess: (res: { ok: boolean; message: string; isComplete: boolean; missingFields?: string[] }) => {
      setSubmitResult(res);
    },
    onError: (e: Error) => {
      setSubmitResult({ ok: false, message: e.message, isComplete: false });
    },
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorState message={(error as Error).message} />;
  if (!data) return <ErrorState message="Form tidak tersedia" />;
  if (data.status === "submitted") return <SuccessState message={data.message ?? "Data sudah kami terima."} />;
  if (submitResult?.isComplete) return <SuccessState message={submitResult.message} />;

  // Preview mode banner
  const previewBanner = isPreview ? (
    <div className="bg-amber-400 text-amber-900 text-center text-xs font-semibold py-2 px-4">
      🔍 MODE PREVIEW — Form ini tidak aktif. Hanya untuk pratinjau tampilan admin.
    </div>
  ) : null;

  const allFields = [
    ...data.builtinFields.map(normalizeField),
    ...data.customFields.map(normalizeField),
  ].filter((f, i, arr) => arr.findIndex((x) => x.name === f.name) === i) // dedupe
   .filter((f) => f.name.trim() !== "" && f.label.trim() !== ""); // remove empty/unnamed fields

  // Pre-fill from already collected fields
  const prefilled: Record<string, string> = {};
  for (const [k, v] of Object.entries(data.collectedFields ?? {})) {
    if (!values[k] && v) prefilled[k] = String(v);
  }
  const merged = { ...prefilled, ...values };

  function handleChange(name: string, val: string) {
    setValues((p) => ({ ...p, [name]: val }));
  }

  function handleBlur(name: string) {
    setTouched((p) => new Set(p).add(name));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const allNames = new Set(allFields.map((f) => f.name));
    setTouched(allNames);
    mutation.mutate();
  }

  const requiredFields = allFields.filter((f) => f.required && f.type !== "file");
  const filledRequired = requiredFields.filter((f) => (merged[f.name] ?? "").trim() !== "").length;
  const progress = requiredFields.length > 0 ? Math.round((filledRequired / requiredFields.length) * 100) : 100;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {previewBanner}
    <div className="p-4 py-8">
      <div className="max-w-lg mx-auto space-y-4">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white text-lg">
              📋
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-800">{data.formTitle}</h1>
              {data.intentName && <p className="text-xs text-blue-600">{data.intentName}</p>}
            </div>
          </div>
          {data.formDescription && (
            <p className="text-sm text-gray-500 mt-2">{data.formDescription}</p>
          )}

          {/* Progress bar */}
          {requiredFields.length > 0 && (
            <div className="mt-4">
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>Progres pengisian</span>
                <span>{filledRequired}/{requiredFields.length} field wajib</span>
              </div>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="bg-white rounded-2xl shadow-sm p-6 space-y-5">
            {allFields.map((field) => {
              const val = merged[field.name] ?? "";
              const isTouched = touched.has(field.name);
              const hasError = isTouched && field.required && field.type !== "file" && !val.trim();

              return (
                <div key={field.name} className="space-y-1.5">
                  <label className="block text-sm font-medium text-gray-700">
                    {field.label}
                    {field.required && <span className="text-red-500 ml-0.5">*</span>}
                  </label>
                  <div onBlur={() => handleBlur(field.name)}>
                    <FormField
                      field={field}
                      value={val}
                      onChange={(v) => handleChange(field.name, v)}
                      hasError={hasError}
                    />
                  </div>
                  {hasError && (
                    <p className="text-xs text-red-500">Field ini wajib diisi</p>
                  )}
                  {!hasError && field.helpText && field.type !== "file" && (
                    <p className="text-xs text-gray-400">{field.helpText}</p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Error banner — tampilkan field mana yang masih kosong */}
          {submitResult && !submitResult.isComplete && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 text-sm text-orange-700 space-y-2">
              <p className="font-medium">{submitResult.message}</p>
              {submitResult.missingFields && submitResult.missingFields.length > 0 && (
                <div>
                  <p className="text-xs text-orange-600 mb-1">Field yang belum diisi:</p>
                  <ul className="space-y-1">
                    {submitResult.missingFields.map((fname) => {
                      const fieldDef = allFields.find((f) => f.name === fname);
                      const label = fieldDef?.label ?? fname;
                      return (
                        <li key={fname} className="flex items-center gap-1.5 text-xs font-medium">
                          <span className="text-red-500">●</span>
                          <span>{label}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Submit */}
          <div className="bg-white rounded-2xl shadow-sm p-4">
            <button
              type="submit"
              disabled={mutation.isPending}
              className="w-full py-3 px-6 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold rounded-xl transition text-sm"
            >
              {mutation.isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Mengirim data...
                </span>
              ) : "Kirim Data"}
            </button>
            <p className="text-center text-xs text-gray-400 mt-2">
              Data Anda aman dan digunakan hanya untuk keperluan layanan
            </p>
          </div>
        </form>
      </div>
    </div>
    </div>
  );
}
