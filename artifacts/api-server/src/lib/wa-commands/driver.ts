/**
 * Sprint 10A-1 + 10A-4 — Driver WhatsApp Commands
 *
 * Commands:
 *   DAFTAR DRIVER                          — generate 72h portal token & link
 *   STATUS DRIVER                          — status ringkas driver
 *   BBM [PLAT] [LITER] [ODOMETER]          — log isi bahan bakar
 *   RUSAK [PLAT] [DESKRIPSI...]            — lapor kerusakan kendaraan
 *   POSISI [PLAT] [LOKASI...]              — update posisi kendaraan
 *   MULAI TRIP [TUJUAN...]                 — mulai trip (kendaraan dari assigned vehicle)
 *   SELESAI TRIP [KM?]                     — selesaikan trip aktif
 *   HELP DRIVER                            — daftar perintah driver
 */

import { randomBytes } from "crypto";
import { eq, and, desc } from "drizzle-orm";
import {
  db, fleetUnitsTable, fleetFuelLogsTable, fleetMaintenanceRecordsTable,
  aiTasksTable, teamMembersTable, fleetDriversTable, fleetUtilizationLogsTable,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import { sendFonnte } from "../fonnte";
import { logger } from "../logger";
import { plateWhere } from "../plate-number";
import type { WaCommandContext, WaCommandResult } from "./types";

function baseUrl(): string {
  if (process.env["BASE_URL"]) return process.env["BASE_URL"];
  const domains = process.env["REPLIT_DOMAINS"] ?? "";
  if (domains) {
    const first = domains.split(",")[0]?.trim();
    if (first) return `https://${first}`;
  }
  const devDomain = process.env["REPLIT_DEV_DOMAIN"] ?? "";
  if (devDomain) return `https://${devDomain}`;
  return "http://localhost:5000";
}

/** Fire-and-forget: refresh driver memory snapshot after significant events */
async function triggerMemoryRefresh(driverId: number): Promise<void> {
  try {
    const { supabaseQuery } = await import("../supabase-db");
    const driver = await db.select({ fullName: fleetDriversTable.fullName, primaryVehicleId: fleetDriversTable.primaryVehicleId })
      .from(fleetDriversTable).where(eq(fleetDriversTable.id, driverId)).limit(1).then(r => r[0] ?? null);
    if (!driver) return;
    // Update refreshed_at marker so next GET /memory/refresh picks it up
    await supabaseQuery(`
      INSERT INTO driver_memory_snapshots (driver_id, refreshed_at, updated_at)
      VALUES ($1, NOW(), NOW())
      ON CONFLICT (driver_id) DO UPDATE SET refreshed_at = NOW(), updated_at = NOW()
    `, [driverId]);
  } catch { /* non-fatal */ }
}

export async function handleDriverCommand(
  ctx: WaCommandContext,
): Promise<WaCommandResult | null> {
  const { command, args, rawArgs, phone, user, companyId } = ctx;

  // ── HELP DRIVER ─────────────────────────────────────────────────────────────
  if (command === "HELP DRIVER" || (command === "HELP" && args[0] === "DRIVER")) {
    return {
      reply:
        `🚛 *Menu Driver*\n\n` +
        `📝 *DAFTAR DRIVER*\n  Daftar / buka portal driver\n\n` +
        `📋 *STATUS DRIVER*\n  Lihat status Anda\n\n` +
        `⛽ *BBM [PLAT] [LITER] [ODOMETER]*\n  Log pengisian BBM\n  _Contoh: BBM B1234XYZ 40 125000_\n\n` +
        `🔧 *RUSAK [PLAT] [DESKRIPSI]*\n  Lapor kerusakan\n  _Contoh: RUSAK B1234XYZ Rem bunyi_\n\n` +
        `📍 *POSISI [PLAT] [LOKASI]*\n  Update posisi\n  _Contoh: POSISI B1234XYZ Cikampek KM72_\n\n` +
        `🟢 *MULAI TRIP [TUJUAN]*\n  Mulai trip\n  _Contoh: MULAI TRIP Surabaya_\n\n` +
        `🏁 *SELESAI TRIP [KM]*\n  Selesaikan trip\n  _Contoh: SELESAI TRIP 128500_\n\n` +
        `📋 *MENU*\n  Menu utama`,
      handled: true,
    };
  }

  // ── DAFTAR DRIVER ────────────────────────────────────────────────────────────
  if (command === "DAFTAR DRIVER") {
    // Find existing driver record by phone
    const existing = await db
      .select({ id: fleetDriversTable.id, fullName: fleetDriversTable.fullName })
      .from(fleetDriversTable)
      .where(eq(fleetDriversTable.phone, phone))
      .limit(1)
      .then(r => r[0] ?? null);

    // Generate 72h token
    const token = randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + 72 * 3600 * 1000);

    await db.execute(sql`
      INSERT INTO driver_portal_tokens (token, driver_id, phone, expires_at)
      VALUES (${token}, ${existing?.id ?? null}, ${phone}, ${expiresAt.toISOString()})
    `);

    const portalUrl = `${baseUrl()}/driver/home/${token}`;

    return {
      reply: existing
        ? `👋 *Selamat datang, ${existing.fullName}!*\n\n🔗 Portal Driver Anda (aktif 72 jam):\n${portalUrl}\n\n_Gunakan untuk update profil, upload SIM/KTP, dan lihat trip._`
        : `🚛 *Daftar Driver*\n\nBuka link berikut untuk melengkapi data (aktif 72 jam):\n${portalUrl}\n\n_Lengkapi nama, nomor SIM, dan kontak darurat._`,
      handled: true,
    };
  }

  // ── STATUS DRIVER ────────────────────────────────────────────────────────────
  if (command === "STATUS DRIVER") {
    const driver = await db
      .select()
      .from(fleetDriversTable)
      .where(eq(fleetDriversTable.phone, phone))
      .limit(1)
      .then(r => r[0] ?? null);

    if (!driver) {
      return {
        reply: "❌ Driver tidak ditemukan.\n\nKirim *DAFTAR DRIVER* untuk mendaftar.",
        handled: true,
      };
    }

    // Assigned vehicle
    let vehicleText = "_Belum ada kendaraan_";
    if (driver.primaryVehicleId) {
      const v = await db
        .select({ plateNumber: fleetUnitsTable.plateNumber, vehicleType: fleetUnitsTable.vehicleType })
        .from(fleetUnitsTable)
        .where(eq(fleetUnitsTable.id, driver.primaryVehicleId))
        .limit(1)
        .then(r => r[0] ?? null);
      if (v) vehicleText = `${v.plateNumber} (${v.vehicleType})`;
    }

    // Active trip
    let tripText = "Tidak ada trip aktif";
    const tripRows = await db.execute(sql`
      SELECT destination, actual_departure FROM fleet_utilization_logs
      WHERE driver_id = ${driver.id} AND status = 'on_route'
      ORDER BY actual_departure DESC LIMIT 1
    `);
    if ((tripRows.rows as Record<string, unknown>[]).length > 0) {
      const trip = (tripRows.rows as Record<string, unknown>[])[0]!;
      tripText = `🟢 On-route → ${String(trip["destination"] ?? "")}`;
    }

    // Document status
    const docRows = await db.execute(sql`
      SELECT document_type FROM driver_documents WHERE driver_id = ${driver.id} AND is_current = true
    `);
    const uploaded = new Set((docRows.rows as Record<string, unknown>[]).map(r => String(r["document_type"])));
    const missingDocs = ["sim", "ktp", "medical", "photo"].filter(t => !uploaded.has(t));

    // License expiry
    let licWarning = "";
    if (driver.licenseExpired) {
      const days = Math.ceil((new Date(driver.licenseExpired).getTime() - Date.now()) / 86_400_000);
      if (days <= 0) licWarning = `\n🚨 *SIM KADALUARSA!*`;
      else if (days <= 30) licWarning = `\n⚠️ SIM kadaluarsa *${days} hari lagi*`;
    }

    const docWarning = missingDocs.length > 0
      ? `\n📄 Dokumen kurang: ${missingDocs.map(d => d.toUpperCase()).join(", ")}`
      : "\n📄 Dokumen: ✅ Lengkap";

    return {
      reply:
        `📋 *Status Driver: ${driver.fullName}*\n\n` +
        `🚛 Kendaraan: ${vehicleText}\n` +
        `🗺️ Trip: ${tripText}\n` +
        `📄 SIM: ${driver.licenseNumber} (${driver.licenseType ?? "B2"})${licWarning}` +
        docWarning +
        `\n\nKetik *DAFTAR DRIVER* untuk buka portal.`,
      handled: true,
    };
  }

  // ── MULAI TRIP [TUJUAN...] ───────────────────────────────────────────────────
  if (command === "MULAI TRIP") {
    const tujuan = rawArgs.trim() || args.join(" ");
    if (!tujuan) {
      return {
        reply:
          `❓ *Format MULAI TRIP Salah*\n\n` +
          `Gunakan: *MULAI TRIP [TUJUAN]*\n\n` +
          `Contoh: MULAI TRIP Surabaya`,
        handled: true,
      };
    }

    const driver = await db
      .select()
      .from(fleetDriversTable)
      .where(eq(fleetDriversTable.phone, phone))
      .limit(1)
      .then(r => r[0] ?? null);

    if (!driver) {
      return {
        reply: "❌ Driver tidak ditemukan.\n\nKirim *DAFTAR DRIVER* untuk mendaftar.",
        handled: true,
      };
    }

    if (!driver.primaryVehicleId) {
      return {
        reply: "❌ Belum ada kendaraan yang ditugaskan.\nHubungi admin untuk assignment kendaraan.",
        handled: true,
      };
    }

    // Check active trip
    const existingTrip = await db.execute(sql`
      SELECT id FROM fleet_utilization_logs WHERE driver_id = ${driver.id} AND status = 'on_route' LIMIT 1
    `);
    if ((existingTrip.rows as Record<string, unknown>[]).length > 0) {
      return {
        reply: "❌ Sudah ada trip aktif.\nSelesaikan trip sebelumnya: *SELESAI TRIP [KM]*",
        handled: true,
      };
    }

    const vehicle = await db
      .select({ plateNumber: fleetUnitsTable.plateNumber })
      .from(fleetUnitsTable)
      .where(eq(fleetUnitsTable.id, driver.primaryVehicleId))
      .limit(1)
      .then(r => r[0] ?? null);

    await db.execute(sql`
      INSERT INTO fleet_utilization_logs (company_id, fleet_unit_id, driver_id, origin, destination, trip_purpose, actual_departure, status, created_at, updated_at)
      VALUES (${companyId ?? "default"}, ${driver.primaryVehicleId}, ${driver.id}, ${driver.baseLocation ?? "Gudang"}, ${tujuan}, 'pengiriman', NOW(), 'on_route', NOW(), NOW())
    `);

    // Update vehicle status
    await db.execute(sql`UPDATE fleet_units SET status = 'on_route', updated_at = NOW() WHERE id = ${driver.primaryVehicleId}`);

    // Auto-refresh memory
    triggerMemoryRefresh(driver.id).catch(() => {});

    const now = new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
    return {
      reply:
        `🟢 *Trip Dimulai!*\n\n` +
        `🚛 Kendaraan: ${vehicle?.plateNumber ?? "-"}\n` +
        `🗺️ Tujuan: ${tujuan}\n` +
        `🕐 Berangkat: ${now}\n\n` +
        `_Kirim *SELESAI TRIP [ODOMETER]* saat tiba._`,
      handled: true,
    };
  }

  // ── SELESAI TRIP [KM?] ───────────────────────────────────────────────────────
  if (command === "SELESAI TRIP") {
    const kmArg = args[0] ? parseFloat(args[0]) : null;
    const actualKm = kmArg && !isNaN(kmArg) ? kmArg : null;

    const driver = await db
      .select()
      .from(fleetDriversTable)
      .where(eq(fleetDriversTable.phone, phone))
      .limit(1)
      .then(r => r[0] ?? null);

    if (!driver) {
      return {
        reply: "❌ Driver tidak ditemukan. Kirim *DAFTAR DRIVER* untuk mendaftar.",
        handled: true,
      };
    }

    const tripRows = await db.execute(sql`
      SELECT id, fleet_unit_id, actual_departure, destination FROM fleet_utilization_logs
      WHERE driver_id = ${driver.id} AND status = 'on_route'
      ORDER BY actual_departure DESC LIMIT 1
    `);
    const trip = (tripRows.rows as Record<string, unknown>[])[0] ?? null;

    if (!trip) {
      return {
        reply: "❌ Tidak ada trip aktif.\n\nKirim *MULAI TRIP [TUJUAN]* untuk memulai trip.",
        handled: true,
      };
    }

    const durationMinutes = trip["actual_departure"]
      ? Math.round((Date.now() - new Date(trip["actual_departure"] as string).getTime()) / 60_000)
      : null;

    await db.execute(sql`
      UPDATE fleet_utilization_logs
      SET status = 'completed', actual_arrival = NOW(), actual_km = ${actualKm}, updated_at = NOW()
      WHERE id = ${trip["id"] as number}
    `);

    // Return vehicle to available
    await db.execute(sql`
      UPDATE fleet_units SET status = 'available', updated_at = NOW()
      WHERE id = ${trip["fleet_unit_id"] as number}
    `);

    // Update odometer if km provided
    if (actualKm) {
      await db.execute(sql`
        UPDATE fleet_units SET current_odometer_km = ${actualKm}, updated_at = NOW()
        WHERE id = ${trip["fleet_unit_id"] as number}
      `);
    }

    // Auto-refresh memory
    triggerMemoryRefresh(driver.id).catch(() => {});

    const durasiText = durationMinutes ? `${Math.floor(durationMinutes / 60)} jam ${durationMinutes % 60} menit` : "-";
    const kmText = actualKm ? `${actualKm.toLocaleString("id-ID")} km` : "_tidak dicatat_";

    return {
      reply:
        `🏁 *Trip Selesai!*\n\n` +
        `🗺️ Tujuan: ${String(trip["destination"] ?? "")}\n` +
        `⏱️ Durasi: ${durasiText}\n` +
        `📏 Odometer: ${kmText}\n\n` +
        `✅ Terima kasih! Istirahat sejenak sebelum trip berikutnya.`,
      handled: true,
    };
  }

  // ── BBM [PLAT] [LITER] [ODOMETER] ──────────────────────────────────────────
  if (command === "BBM") {
    const plat = args[0];
    const liter = parseFloat(args[1] ?? "");
    const odometer = parseFloat(args[2] ?? "");

    if (!plat || isNaN(liter) || isNaN(odometer)) {
      return {
        reply:
          `❓ *Format BBM Salah*\n\n` +
          `Gunakan: *BBM [PLAT] [LITER] [ODOMETER]*\n\n` +
          `Contoh: BBM B1234XYZ 40 125000\n` +
          `_(plat = nomor kendaraan, liter = jumlah BBM, odometer = km sekarang)_`,
        handled: true,
      };
    }

    const unit = await db
      .select()
      .from(fleetUnitsTable)
      .where(
        and(
          eq(fleetUnitsTable.companyId, companyId),
          plateWhere(fleetUnitsTable.plateNumber, plat),
        ),
      )
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!unit) {
      return {
        reply: `❌ Kendaraan dengan plat *${plat.toUpperCase()}* tidak ditemukan.\n\nPastikan plat kendaraan benar.`,
        handled: true,
      };
    }

    // Hitung KM/L dari last fuel log
    const lastLog = await db
      .select()
      .from(fleetFuelLogsTable)
      .where(eq(fleetFuelLogsTable.fleetUnitId, unit.id))
      .orderBy(desc(fleetFuelLogsTable.loggedAt))
      .limit(1)
      .then((r) => r[0] ?? null);

    let kmPerLiter: number | null = null;
    let isAnomaly = false;
    let anomalyNote = "";

    if (lastLog && lastLog.odometerKm && odometer > lastLog.odometerKm) {
      const kmTraveled = odometer - lastLog.odometerKm;
      kmPerLiter = kmTraveled / liter;

      const prevKmL = lastLog.kmPerLiter ?? null;
      if (kmPerLiter < 2) {
        isAnomaly = true;
        anomalyNote = `⚠️ KM/L sangat rendah (${kmPerLiter.toFixed(1)}). Periksa kondisi kendaraan.`;
      } else if (prevKmL && Math.abs(kmPerLiter - prevKmL) / prevKmL > 0.4) {
        isAnomaly = true;
        anomalyNote = `⚠️ Efisiensi BBM berubah signifikan (${kmPerLiter.toFixed(1)} vs normal ${prevKmL.toFixed(1)} KM/L).`;
      }
    }

    await db.insert(fleetFuelLogsTable).values({
      companyId,
      fleetUnitId: unit.id,
      loggedAt: new Date(),
      odometerKm: odometer,
      litersFilled: liter,
      kmPerLiter: kmPerLiter ?? undefined,
      isAnomaly,
      anomalyReason: isAnomaly ? anomalyNote : undefined,
      createdBy: user.name ?? phone,
      notes: `Log via WhatsApp oleh ${user.name ?? phone}`,
    });

    await db
      .update(fleetUnitsTable)
      .set({ currentOdometerKm: odometer, updatedAt: new Date() })
      .where(eq(fleetUnitsTable.id, unit.id));

    if (isAnomaly) {
      const supervisors = await db
        .select({ phone: teamMembersTable.phone, name: teamMembersTable.name })
        .from(teamMembersTable)
        .where(and(eq(teamMembersTable.companyId, companyId), eq(teamMembersTable.role, "supervisor")))
        .limit(3);

      for (const sup of supervisors) {
        if (sup.phone) {
          sendFonnte(
            sup.phone,
            `🚨 *Anomali BBM Terdeteksi*\n\nKendaraan: ${unit.plateNumber}\nDriver: ${user.name ?? phone}\nLiter: ${liter} L | Odometer: ${odometer.toLocaleString("id-ID")} km\n${anomalyNote}`,
          ).catch(() => {});
        }
      }
    }

    // Auto-refresh driver memory
    const driverForBBM = await db.select({ id: fleetDriversTable.id })
      .from(fleetDriversTable).where(eq(fleetDriversTable.phone, phone)).limit(1).then(r => r[0] ?? null);
    if (driverForBBM) triggerMemoryRefresh(driverForBBM.id).catch(() => {});

    const kmLText = kmPerLiter ? `📊 Efisiensi: ${kmPerLiter.toFixed(1)} KM/L` : "📊 Efisiensi: _(data odometer sebelumnya belum ada)_";
    return {
      reply:
        `✅ *BBM Tercatat!*\n\n` +
        `🚛 Kendaraan: ${unit.plateNumber}\n` +
        `⛽ Isi BBM: ${liter} liter\n` +
        `📏 Odometer: ${odometer.toLocaleString("id-ID")} km\n` +
        `${kmLText}\n` +
        (isAnomaly ? `\n${anomalyNote}` : `\n✅ Efisiensi normal`),
      handled: true,
    };
  }

  // ── RUSAK [PLAT] [DESKRIPSI...] ─────────────────────────────────────────────
  if (command === "RUSAK") {
    const plat = args[0];
    const deskripsi = args.slice(1).join(" ") || rawArgs.replace(plat ?? "", "").trim();

    if (!plat || !deskripsi) {
      return {
        reply:
          `❓ *Format RUSAK Salah*\n\n` +
          `Gunakan: *RUSAK [PLAT] [DESKRIPSI]*\n\n` +
          `Contoh: RUSAK B1234XYZ Rem belakang bunyi keras`,
        handled: true,
      };
    }

    const unit = await db
      .select()
      .from(fleetUnitsTable)
      .where(and(eq(fleetUnitsTable.companyId, companyId), plateWhere(fleetUnitsTable.plateNumber, plat)))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!unit) {
      return { reply: `❌ Kendaraan *${plat.toUpperCase()}* tidak ditemukan.`, handled: true };
    }

    const [maint] = await db
      .insert(fleetMaintenanceRecordsTable)
      .values({
        companyId,
        fleetUnitId: unit.id,
        maintenanceType: "corrective",
        description: deskripsi,
        odometerAtService: unit.currentOdometerKm ?? undefined,
        serviceDate: new Date().toISOString().split("T")[0]!,
        status: "pending",
        createdBy: user.name ?? phone,
        notes: `Laporan via WhatsApp oleh ${user.name ?? phone}`,
      })
      .returning();

    void maint; // used for type checking only

    const taskNumber = `MNT-${Date.now().toString().slice(-6)}`;
    await db.insert(aiTasksTable).values({
      companyId,
      taskNumber,
      source: "whatsapp_command",
      title: `Kerusakan ${unit.plateNumber}: ${deskripsi.slice(0, 80)}`,
      description: `Laporan kerusakan dari driver via WhatsApp.\nKendaraan: ${unit.plateNumber}\nDeskripsi: ${deskripsi}\nDriver: ${user.name ?? phone}`,
      category: "fleet_maintenance",
      priority: "high",
      status: "new_inquiry",
      aiIntent: "fleet_maintenance_report",
    });

    const supervisors = await db
      .select({ phone: teamMembersTable.phone })
      .from(teamMembersTable)
      .where(and(eq(teamMembersTable.companyId, companyId), eq(teamMembersTable.role, "supervisor")))
      .limit(3);

    for (const sup of supervisors) {
      if (sup.phone) {
        sendFonnte(sup.phone, `🔧 *Laporan Kerusakan*\n\nKendaraan: ${unit.plateNumber}\nDriver: ${user.name ?? phone}\nMasalah: ${deskripsi}\nNo. Tiket: ${taskNumber}`).catch(() => {});
      }
    }

    return {
      reply:
        `✅ *Laporan Kerusakan Tercatat*\n\n` +
        `🚛 Kendaraan: ${unit.plateNumber}\n` +
        `🔧 Masalah: ${deskripsi}\n` +
        `📋 No. Tiket: *${taskNumber}*\n\n` +
        `✅ Supervisor sudah diberitahu.\n` +
        `_Tunggu konfirmasi dari tim mekanik._`,
      handled: true,
    };
  }

  // ── POSISI [PLAT] [LOKASI...] ───────────────────────────────────────────────
  if (command === "POSISI") {
    const plat = args[0];
    const lokasi = args.slice(1).join(" ") || rawArgs.replace(plat ?? "", "").trim();

    if (!plat || !lokasi) {
      return {
        reply:
          `❓ *Format POSISI Salah*\n\n` +
          `Gunakan: *POSISI [PLAT] [LOKASI]*\n\n` +
          `Contoh: POSISI B1234XYZ Cikampek KM72`,
        handled: true,
      };
    }

    const unit = await db
      .select()
      .from(fleetUnitsTable)
      .where(and(eq(fleetUnitsTable.companyId, companyId), plateWhere(fleetUnitsTable.plateNumber, plat)))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!unit) {
      return { reply: `❌ Kendaraan *${plat.toUpperCase()}* tidak ditemukan.`, handled: true };
    }

    await db
      .update(fleetUnitsTable)
      .set({
        notes: `Posisi terakhir: ${lokasi} (${new Date().toLocaleString("id-ID")}) — laporan via WA oleh ${user.name ?? phone}`,
        updatedAt: new Date(),
      })
      .where(eq(fleetUnitsTable.id, unit.id));

    const now = new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
    return {
      reply:
        `📍 *Posisi Tercatat!*\n\n` +
        `🚛 Kendaraan: ${unit.plateNumber}\n` +
        `📍 Lokasi: ${lokasi}\n` +
        `🕐 Waktu: ${now}\n\n` +
        `_Posisi berhasil diperbarui._`,
      handled: true,
    };
  }

  return null;
}
