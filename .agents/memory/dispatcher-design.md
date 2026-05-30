---
name: Smart AI Dispatcher design
description: Arsitektur dan keputusan desain Smart AI Dispatcher Rule Engine + GPT
---

## Scoring Rule Engine (total 0-100)

| Komponen         | Max | Logika |
|-----------------|-----|--------|
| Workload Score  |  40 | `40 × (1 - activeCount/8)` — semakin sedikit task aktif, semakin tinggi |
| Skill Score     |  30 | 30 jika divisi exact match, 18 jika role match, 5 jika tidak ada match |
| Urgency Score   |  20 | `20 × availabilityRatio × (urgencyWeight/4)` — overdue lebih urgen |
| Availability    |  10 | +10 untuk senior member di high-priority task; +8 jika tidak ada task |

## CATEGORY_DIVISION_MAP
- Import/Export/Air Freight/Customs/Trucking/Forwarding → divisi yang relevan
- Didefinisikan di `lib/dispatcher.ts`, mudah diextend

## GPT Component
- Model: `gpt-4o-mini`, max 180 tokens, temperature 0.4
- Prompt: konteks task + top candidate + runner-up → penjelasan 3 kalimat Bahasa Indonesia
- Fallback: `fallbackExplanation()` jika GPT gagal

## Frontend (ai-dispatcher.tsx)
- `ConfidenceRing` — SVG donut chart 0-100%
- `ScoreBar` — breakdown 4 komponen skor
- `SuggestionDialog` — modal GPT explanation + override manual + textarea alasan
- Tab Antrian: task unassigned + tombol "AI Assign" per task
- Tab Riwayat: dispatcher_logs dengan badge Override jika admin memilih lain dari saran AI
- Auto-Dispatch All: dispatch semua unassigned sekaligus (max 20 per call)

## Tables
- `dispatcher_logs` — menyimpan: suggestion, final assignment, wasOverridden, 4 skor, explanation, allCandidatesJson

## Why these design choices
- Rule Engine dulu baru GPT: rule bisa jalan offline/murah; GPT hanya untuk explainability
- wasOverridden tracking: memungkinkan analisis akurasi AI vs keputusan manusia di kemudian hari
- `workloadMap` di-query sekali per suggest call dengan GROUP BY untuk efisiensi
