/**
 * Sprint 10A-1 — Driver WhatsApp Commands
 *
 * Commands:
 *   BBM [PLAT] [LITER] [ODOMETER]     — log isi bahan bakar
 *   RUSAK [PLAT] [DESKRIPSI...]       — lapor kerusakan kendaraan
 *   POSISI [PLAT] [LOKASI...]         — update posisi kendaraan
 *   HELP DRIVER                        — daftar perintah driver
 */

import { eq, ilike, and, desc } from "drizzle-orm";
import {
  db, fleetUnitsTable, fleetFuelLogsTable, fleetMaintenanceRecordsTable,
  aiTasksTable, teamMembersTable, fleetDriversTable,
} from "@workspace/db";
import { sendFonnte } from "../fonnte";
import { logger } from "../logger";
import type { WaCommandContext, WaCommandResult } from "./types";

export async function handleDriverCommand(
  ctx: WaCommandContext,
): Promise<WaCommandResult | null> {
  const { command, args, rawArgs, phone, user, companyId } = ctx;

  // ── HELP DRIVER ─────────────────────────────────────────────────────────────
  if (command === "HELP DRIVER" || (command === "HELP" && args[0] === "DRIVER")) {
    return {
      reply:
        `🚛 *Menu Driver*\n\n` +
        `⛽ *BBM [PLAT] [LITER] [ODOMETER]*\n  Log pengisian BBM\n  _Contoh: BBM B1234XYZ 40 125000_\n\n` +
        `🔧 *RUSAK [PLAT] [DESKRIPSI]*\n  Lapor kerusakan\n  _Contoh: RUSAK B1234XYZ Rem belakang bunyi_\n\n` +
        `📍 *POSISI [PLAT] [LOKASI]*\n  Update posisi\n  _Contoh: POSISI B1234XYZ Cikampek KM72_\n\n` +
        `📋 *MENU*\n  Menu utama`,
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
          ilike(fleetUnitsTable.plateNumber, plat),
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

      // Anomaly detection: KM/L too low or too high
      const prevKmL = lastLog.kmPerLiter ?? null;
      if (kmPerLiter < 2) {
        isAnomaly = true;
        anomalyNote = `⚠️ KM/L sangat rendah (${kmPerLiter.toFixed(1)}). Periksa kondisi kendaraan.`;
      } else if (prevKmL && Math.abs(kmPerLiter - prevKmL) / prevKmL > 0.4) {
        isAnomaly = true;
        anomalyNote = `⚠️ Efisiensi BBM berubah signifikan (${kmPerLiter.toFixed(1)} vs normal ${prevKmL.toFixed(1)} KM/L).`;
      }
    }

    // Insert fuel log
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

    // Update unit odometer
    await db
      .update(fleetUnitsTable)
      .set({ currentOdometerKm: odometer, updatedAt: new Date() })
      .where(eq(fleetUnitsTable.id, unit.id));

    // Notify supervisor if anomaly
    if (isAnomaly) {
      const supervisors = await db
        .select({ phone: teamMembersTable.phone, name: teamMembersTable.name })
        .from(teamMembersTable)
        .where(
          and(
            eq(teamMembersTable.companyId, companyId),
            eq(teamMembersTable.role, "supervisor"),
          ),
        )
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
      .where(
        and(
          eq(fleetUnitsTable.companyId, companyId),
          ilike(fleetUnitsTable.plateNumber, plat),
        ),
      )
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!unit) {
      return {
        reply: `❌ Kendaraan *${plat.toUpperCase()}* tidak ditemukan.`,
        handled: true,
      };
    }

    // Create maintenance request
    const [maint] = await db
      .insert(fleetMaintenanceRecordsTable)
      .values({
        companyId,
        fleetUnitId: unit.id,
        maintenanceType: "corrective",
        description: deskripsi,
        odometerAtService: unit.currentOdometerKm ?? undefined,
        serviceDate: new Date().toISOString().split("T")[0],
        status: "pending",
        createdBy: user.name ?? phone,
        notes: `Laporan via WhatsApp oleh ${user.name ?? phone}`,
      })
      .returning();

    // Create AI task for this issue
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

    // Notify supervisors
    const supervisors = await db
      .select({ phone: teamMembersTable.phone, name: teamMembersTable.name })
      .from(teamMembersTable)
      .where(
        and(
          eq(teamMembersTable.companyId, companyId),
          eq(teamMembersTable.role, "supervisor"),
        ),
      )
      .limit(3);

    for (const sup of supervisors) {
      if (sup.phone) {
        sendFonnte(
          sup.phone,
          `🔧 *Laporan Kerusakan Kendaraan*\n\nKendaraan: ${unit.plateNumber}\nDriver: ${user.name ?? phone}\nMasalah: ${deskripsi}\nNo. Tiket: ${taskNumber}\n\nSegera tindak lanjuti.`,
        ).catch(() => {});
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
      .where(
        and(
          eq(fleetUnitsTable.companyId, companyId),
          ilike(fleetUnitsTable.plateNumber, plat),
        ),
      )
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!unit) {
      return {
        reply: `❌ Kendaraan *${plat.toUpperCase()}* tidak ditemukan.`,
        handled: true,
      };
    }

    // Update notes field as position log (fleet_gps_logs table may not exist yet)
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
