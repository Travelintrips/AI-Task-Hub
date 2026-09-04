/**
 * Public Mini Form Page — Sprint 9B
 * Route: /mini-form/:type/:token
 * No authentication required — token-based access
 */

import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const SPORT_CENTER_FACILITY_OPTIONS = [
  "Lapangan Badminton A",
  "Lapangan Badminton B",
  "Lapangan Tenis",
  "Lapangan Multi Guna",
  "GYM",
  "Meja Billiard",
];
const SPORT_CENTER_DURATION_OPTIONS = ["1 jam", "2 jam", "3 jam", "Full Day"];

function normalizeSportCenterDuration(value: unknown): string {
  const duration = String(value ?? "").trim();
  return SPORT_CENTER_DURATION_OPTIONS.includes(duration) ? duration : "1 jam";
}

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}/api${path}`, {
    cache: "no-store",
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
  facilityOptions?: string[];
  collectedFields: Record<string, unknown>;
  missingFields: string[];
  requiredDocuments: string[];
  uploadedDocuments: string[];
}

function normalizeField(f: FieldDef): {
  name: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
  helpText?: string;
  placeholder?: string;
} {
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
        <h2 className="text-lg font-semibold text-gray-800 mb-2">
          Form Tidak Tersedia
        </h2>
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
        <p className="text-xs text-gray-400 mt-4">
          Anda dapat menutup halaman ini.
        </p>
      </div>
    </div>
  );
}

function FormField({
  field,
  value,
  onChange,
  hasError,
  disabled = false,
}: {
  field: ReturnType<typeof normalizeField>;
  value: string;
  onChange: (v: string) => void;
  hasError: boolean;
  disabled?: boolean;
}) {
  const base = `w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition ${
    hasError
      ? "border-red-400 focus:ring-2 focus:ring-red-200"
      : "border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
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
  if (field.type === "select") {
    return (
      <select
        className={base}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        <option value="">— Pilih —</option>
        {(field.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  // File fields are handled separately in MiniFormPage (see FileFieldRenderer)
  if (field.type === "file") {
    return null;
  }
  return (
    <input
      type={
        field.type === "number"
          ? "number"
          : field.type === "date"
            ? "date"
            : "text"
      }
      className={base}
      placeholder={field.placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Render file upload field dengan progress indicator dan status upload */
function FileFieldRenderer({
  field,
  currentValue,
  isUploading,
  uploadError,
  onFileChange,
}: {
  field: ReturnType<typeof normalizeField>;
  currentValue: string;
  isUploading: boolean;
  uploadError?: string;
  onFileChange: (file: File) => void;
}) {
  const isUploaded = currentValue.startsWith("http");
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700">
        {field.label}
        {field.required && <span className="text-red-500 ml-0.5">*</span>}
      </label>

      {isUploaded ? (
        <div className="flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2.5 text-sm text-green-700">
          <span>✅</span>
          <span className="truncate flex-1">
            {currentValue.split("/").pop()?.split("?")[0] ?? "File terupload"}
          </span>
          <label className="cursor-pointer text-xs text-blue-500 underline shrink-0">
            Ganti
            <input
              type="file"
              className="hidden"
              accept=".jpg,.jpeg,.png,.pdf,.doc,.docx"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFileChange(f);
              }}
            />
          </label>
        </div>
      ) : isUploading ? (
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm text-blue-600">
          <span className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin shrink-0" />
          <span>Mengupload...</span>
        </div>
      ) : (
        <label className="block w-full cursor-pointer rounded-lg border-2 border-dashed border-gray-200 px-4 py-4 text-center hover:border-blue-400 hover:bg-blue-50 transition-colors">
          <div className="text-2xl mb-1">📎</div>
          <p className="text-sm text-gray-500">Pilih atau seret file ke sini</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {field.helpText ?? "PDF, JPG, PNG — maks. 10 MB"}
          </p>
          <input
            type="file"
            className="hidden"
            accept=".jpg,.jpeg,.png,.pdf,.doc,.docx"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFileChange(f);
            }}
          />
        </label>
      )}

      {uploadError && <p className="text-xs text-red-500">⚠️ {uploadError}</p>}
    </div>
  );
}

export default function MiniFormPage() {
  const params = useParams<{
    type?: string;
    token?: string;
    templateId?: string;
  }>();
  const type = params.type;
  const token = params.token;
  const templateId = params.templateId;
  const isPreview = !!templateId || type === "preview";
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitResult, setSubmitResult] = useState<{
    ok: boolean;
    message: string;
    isComplete: boolean;
    missingFields?: string[];
  } | null>(null);
  const [uploadingFields, setUploadingFields] = useState<Set<string>>(
    new Set(),
  );
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});

  async function handleFileUpload(fieldName: string, file: File) {
    setUploadingFields((prev) => new Set(prev).add(fieldName));
    setUploadErrors((prev) => {
      const n = { ...prev };
      delete n[fieldName];
      return n;
    });
    try {
      // 1. Dapatkan signed upload URL dari server
      const urlRes = (await apiFetch("/public/mini-form-upload-url", {
        method: "POST",
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
        }),
      })) as { uploadUrl: string; publicUrl: string; path: string };

      // 2. Upload file langsung ke Supabase Storage
      const uploadRes = await fetch(urlRes.uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      if (!uploadRes.ok) throw new Error(`Upload gagal (${uploadRes.status})`);

      // 3. Simpan public URL sebagai nilai field
      setValues((prev) => ({ ...prev, [fieldName]: urlRes.publicUrl }));
    } catch (err) {
      setUploadErrors((prev) => ({
        ...prev,
        [fieldName]: (err as Error).message ?? "Upload gagal",
      }));
    } finally {
      setUploadingFields((prev) => {
        const n = new Set(prev);
        n.delete(fieldName);
        return n;
      });
    }
  }

  const apiPath = isPreview
    ? `/public/mini-form/preview/${templateId ?? token}`
    : `/public/mini-form/${type}/${token}`;

  const { data, isLoading, error } = useQuery<FormData>({
    queryKey: [
      "mini-form",
      isPreview ? `preview-${templateId}` : `${type}-${token}`,
    ],
    queryFn: () => apiFetch(apiPath),
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    enabled: isPreview ? !!(templateId || token) : !!(type && token),
  });

  const selectedFieldType =
    values.field_type ??
    String(data?.collectedFields?.field_type ?? data?.collectedFields?.field_name ?? "");
  const selectedBookingDate =
    values.booking_date ?? String(data?.collectedFields?.booking_date ?? "");
  const selectedDuration =
    normalizeSportCenterDuration(
      values.duration ?? data?.collectedFields?.duration ?? "1 jam",
    );
  const isFieldBookingForm =
    !isPreview && type?.replace(/_/g, "-") === "field-booking";

  const availabilityQuery = useQuery<{
    checkedDate: string;
    durationMinutes: number;
    facilityIds: number[];
    availableSlots: string[];
  }>({
    queryKey: [
      "mini-form-availability",
      token,
      selectedFieldType,
      selectedBookingDate,
      selectedDuration,
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        fieldType: selectedFieldType,
        bookingDate: selectedBookingDate,
        duration: selectedDuration,
      });
      return apiFetch(
        `/public/mini-form/${type}/${token}/availability?${params.toString()}`,
        { cache: "no-store" },
      );
    },
    enabled:
      isFieldBookingForm &&
      !!type &&
      !!token &&
      !!selectedFieldType &&
      !!selectedBookingDate,
    retry: false,
    staleTime: 0,
    refetchInterval: 15_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    const options =
      data?.facilityOptions?.length
        ? data.facilityOptions
        : isFieldBookingForm
          ? SPORT_CENTER_FACILITY_OPTIONS
          : undefined;
    const current = values.field_type ?? String(data?.collectedFields?.field_type ?? "");
    if (!isFieldBookingForm || !options?.length || !current || options.includes(current)) {
      return;
    }
    const currentLower = current.toLowerCase();
    const compatibleOption = options.find((option) =>
      option.toLowerCase().includes(currentLower),
    );
    if (compatibleOption) {
      setValues((previous) => ({ ...previous, field_type: compatibleOption }));
    }
  }, [
    data?.facilityOptions,
    data?.collectedFields?.field_type,
    isFieldBookingForm,
    values.field_type,
  ]);

  useEffect(() => {
    const selectedStart =
      values.start_time ?? String(data?.collectedFields?.start_time ?? "");
    const available = availabilityQuery.data?.availableSlots;
    if (!available || !selectedStart || available.includes(selectedStart)) return;
    setValues((previous) => ({ ...previous, start_time: "" }));
  }, [availabilityQuery.data?.availableSlots, data?.collectedFields?.start_time, values.start_time]);

  const mutation = useMutation({
    mutationFn: (payload: {
      fields: Record<string, string>;
      uploadedDocuments: string[];
    }) =>
      apiFetch(`/public/mini-form/${type}/${token}`, {
        method: "POST",
        body: JSON.stringify({
          fields: payload.fields,
          submittedBy: "customer",
          uploadedDocuments: payload.uploadedDocuments,
        }),
      }),
    onSuccess: (res: {
      ok: boolean;
      message: string;
      isComplete: boolean;
      missingFields?: string[];
    }) => {
      setSubmitResult(res);
    },
    onError: (e: Error) => {
      setSubmitResult({ ok: false, message: e.message, isComplete: false });
    },
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorState message={(error as Error).message} />;
  if (!data) return <ErrorState message="Form tidak tersedia" />;
  if (data.status === "submitted")
    return <SuccessState message={data.message ?? "Data sudah kami terima."} />;
  if (submitResult?.isComplete)
    return <SuccessState message={submitResult.message} />;

  // Preview mode banner
  const previewBanner = isPreview ? (
    <div className="bg-amber-400 text-amber-900 text-center text-xs font-semibold py-2 px-4">
      🔍 MODE PREVIEW — Form ini tidak aktif. Hanya untuk pratinjau tampilan
      admin.
    </div>
  ) : null;

  let allFields = [
    ...data.builtinFields.map(normalizeField),
    ...data.customFields.map(normalizeField),
  ]
    .map((field) =>
      isFieldBookingForm &&
      (field.name === "duration" ||
        field.label.trim().toLowerCase() === "durasi sewa")
        ? {
            ...field,
            options: SPORT_CENTER_DURATION_OPTIONS,
          }
        : field,
    )
    .filter((f, i, arr) => arr.findIndex((x) => x.name === f.name) === i) // dedupe
    .filter((f) => f.name.trim() !== "" && f.label.trim() !== ""); // remove empty/unnamed fields

  // Keep the booking flow in the natural order: duration determines which
  // start times can still fit before midnight.
  if (isFieldBookingForm) {
    const durationIndex = allFields.findIndex((field) => field.name === "duration");
    const startTimeIndex = allFields.findIndex(
      (field) =>
        field.name === "start_time" ||
        field.label.trim().toLowerCase() === "jam mulai",
    );
    if (durationIndex >= 0 && startTimeIndex >= 0 && durationIndex > startTimeIndex) {
      const durationField = allFields[durationIndex];
      allFields = allFields.filter((_, index) => index !== durationIndex);
      allFields.splice(startTimeIndex, 0, durationField!);
    }
  }

  // Pre-fill from already collected fields
  const prefilled: Record<string, string> = {};
  const availableStartTimes = availabilityQuery.data?.availableSlots;
  for (const [k, v] of Object.entries(data.collectedFields ?? {})) {
    if (
      isFieldBookingForm &&
      k === "start_time" &&
      availableStartTimes &&
      !availableStartTimes.includes(String(v))
    ) {
      continue;
    }
    if (!values[k] && v) {
      prefilled[k] =
        isFieldBookingForm && k === "duration"
          ? normalizeSportCenterDuration(v)
          : String(v);
    }
  }
  const merged = { ...prefilled, ...values };

  function handleChange(name: string, val: string) {
    setValues((p) => ({
      ...p,
      [name]: val,
      ...(name === "field_type" || name === "booking_date" || name === "duration"
        ? { start_time: "" }
        : {}),
    }));
  }

  function handleBlur(name: string) {
    setTouched((p) => new Set(p).add(name));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const allNames = new Set(allFields.map((f) => f.name));
    setTouched(allNames);
    // Keep an explicit list of uploaded document URLs as well as the file
    // fields. The API uses the list to persist uploads across multi-step
    // submissions and to recover if a custom form omits a file field.
    const uploadedDocuments = allFields
      .filter((f) => f.type === "file")
      .map((f) => merged[f.name] ?? "")
      .filter((value) => value.startsWith("http"));
    mutation.mutate({
      fields: merged,
      uploadedDocuments,
    });
  }

  const requiredFields = allFields.filter(
    (f) => f.required && f.type !== "file",
  );
  const filledRequired = requiredFields.filter(
    (f) => (merged[f.name] ?? "").trim() !== "",
  ).length;
  const progress =
    requiredFields.length > 0
      ? Math.round((filledRequired / requiredFields.length) * 100)
      : 100;

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
                <h1 className="text-lg font-bold text-gray-800">
                  {data.formTitle}
                </h1>
                {data.intentName && (
                  <p className="text-xs text-blue-600">{data.intentName}</p>
                )}
              </div>
            </div>
            {data.formDescription && (
              <p className="text-sm text-gray-500 mt-2">
                {data.formDescription}
              </p>
            )}

            {/* Progress bar */}
            {requiredFields.length > 0 && (
              <div className="mt-4">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>Progres pengisian</span>
                  <span>
                    {filledRequired}/{requiredFields.length} field wajib
                  </span>
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
                const hasError =
                  isTouched &&
                  field.required &&
                  field.type !== "file" &&
                  !val.trim();

                // File fields pakai FileFieldRenderer khusus (upload ke Supabase)
                if (field.type === "file") {
                  return (
                    <FileFieldRenderer
                      key={field.name}
                      field={field}
                      currentValue={val}
                      isUploading={uploadingFields.has(field.name)}
                      uploadError={uploadErrors[field.name]}
                      onFileChange={(file) =>
                        handleFileUpload(field.name, file)
                      }
                    />
                  );
                }

                const isStartTimeField =
                  isFieldBookingForm &&
                  (field.name === "start_time" ||
                    field.label.trim().toLowerCase() === "jam mulai");
                const isFacilityTypeField =
                  isFieldBookingForm && field.name === "field_type";
                const renderedField = isStartTimeField
                  ? {
                      ...field,
                      type: "select",
                      options: availabilityQuery.data?.availableSlots ?? [],
                    }
                  : isFacilityTypeField
                    ? {
                        ...field,
                        options:
                          data.facilityOptions?.length
                            ? data.facilityOptions
                            : SPORT_CENTER_FACILITY_OPTIONS,
                      }
                  : field;

                return (
                  <div key={field.name} className="space-y-1.5">
                    <label className="block text-sm font-medium text-gray-700">
                      {field.label}
                      {field.required && (
                        <span className="text-red-500 ml-0.5">*</span>
                      )}
                    </label>
                    <div onBlur={() => handleBlur(field.name)}>
                      <FormField
                        field={renderedField}
                        value={val}
                        onChange={(v) => handleChange(field.name, v)}
                        hasError={hasError}
                        disabled={
                          isStartTimeField &&
                          (availabilityQuery.isLoading ||
                            !selectedFieldType ||
                            !selectedBookingDate ||
                            availabilityQuery.isError ||
                            (availabilityQuery.data?.availableSlots.length ?? 0) === 0)
                        }
                      />
                    </div>
                    {hasError && (
                      <p className="text-xs text-red-500">
                        Field ini wajib diisi
                      </p>
                    )}
                    {!hasError && field.helpText && field.type !== "file" && (
                      <p className="text-xs text-gray-400">{field.helpText}</p>
                    )}
                    {isStartTimeField && availabilityQuery.isLoading && (
                      <p className="text-xs text-blue-600">
                        Memeriksa slot tersedia...
                      </p>
                    )}
                    {isStartTimeField && availabilityQuery.isError && (
                      <p className="text-xs text-red-500">
                        Slot belum dapat diperiksa dari database Sport Center. Silakan pilih ulang tanggal.
                      </p>
                    )}
                    {isStartTimeField &&
                      availabilityQuery.data &&
                      availabilityQuery.data.availableSlots.length === 0 && (
                        <p className="text-xs text-orange-600">
                          Tidak ada jam tersedia untuk tanggal, lapangan, dan durasi tersebut.
                        </p>
                      )}
                  </div>
                );
              })}
            </div>

            {/* Error banner — tampilkan field mana yang masih kosong */}
            {submitResult && !submitResult.isComplete && (
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 text-sm text-orange-700 space-y-2">
                <p className="font-medium">{submitResult.message}</p>
                {submitResult.missingFields &&
                  submitResult.missingFields.length > 0 && (
                    <div>
                      <p className="text-xs text-orange-600 mb-1">
                        Field yang belum diisi:
                      </p>
                      <ul className="space-y-1">
                        {submitResult.missingFields.map((fname) => {
                          const fieldDef = allFields.find(
                            (f) => f.name === fname,
                          );
                          const label = fieldDef?.label ?? fname;
                          return (
                            <li
                              key={fname}
                              className="flex items-center gap-1.5 text-xs font-medium"
                            >
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
                disabled={mutation.isPending || uploadingFields.size > 0}
                className="w-full py-3 px-6 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold rounded-xl transition text-sm"
              >
                {mutation.isPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Mengirim data...
                  </span>
                ) : uploadingFields.size > 0 ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Mengupload file...
                  </span>
                ) : (
                  "Kirim Data"
                )}
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
