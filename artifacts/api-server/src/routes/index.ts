import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tasksRouter from "./tasks";
import teamRouter from "./team";
import messagesRouter from "./messages";
import documentsRouter from "./documents";
import dashboardRouter from "./dashboard";
import whatsappRouter from "./whatsapp";
import aiTasksRouter from "./ai-tasks";
import storageRouter from "./storage";
import attachmentsRouter from "./attachments";
import auditsRouter from "./audits";
import publicRouter from "./public";
import customersRouter from "./customers";
import notificationsRouter from "./notifications";
import authRouter from "./auth";
import fonnteWebhookRouter from "./fonnte-webhook";
import exportRouter from "./export";
import settingsRouter from "./settings";
import checklistsRouter from "./checklists";
import quotationsRouter from "./quotations";
import reportsRouter from "./reports";
import auditLogRouter from "./audit-log";
import shipmentRouter from "./shipment";
import customersCrmRouter from "./customers-crm";
import portalRouter from "./portal";
import dispatcherRouter from "./dispatcher";
import knowledgeBaseRouter from "./knowledge-base";
import governanceRouter from "./governance";
import trainingRouter from "./training";
import observabilityRouter from "./observability";
import customerMemoryRouter from "./customer-memory";
import vendorMemoryRouter from "./vendor-memory";
import intelRouter from "./intel";
import purchasingRequestsRouter from "./purchasing-requests";
import purchasingBenchmarkRouter from "./purchasing-benchmark";
import purchasingBudgetRouter from "./purchasing-budget";
import purchasingMarginRouter from "./purchasing-margin";
import purchasingApprovalRouter from "./purchasing-approval";
import executiveIntelligenceRouter from "./executive-intelligence";
import executiveCommandRouter from "./executive-command";
import fleetUnitsRouter from "./fleet-units";
import fleetDriversRouter from "./fleet-drivers";
import fleetDocumentsRouter from "./fleet-documents";
import fleetMaintenanceRouter from "./fleet-maintenance";
import fleetFuelRouter from "./fleet-fuel";
import fleetTiresRouter from "./fleet-tires";
import fleetUtilizationRouter from "./fleet-utilization";
import fleetRiskRouter from "./fleet-risk";
import fleetCostRouter from "./fleet-cost";
import fleetRouteProfitabilityRouter from "./fleet-route-profitability";
import fleetDriverMemoryRouter from "./fleet-driver-memory";
import fleetReportsRouter from "./fleet-reports";
import intakeSessionsRouter from "./intake-sessions";
import intakeFormRouter from "./intake-form";
import miniFormConfigRouter from "./mini-form-config";
import documentValidationRouter from "./document-validation";
import readinessRouter from "./readiness";
import conversationTestsRouter from "./conversation-tests";
import qualityGateRouter from "./quality-gate";
import waCommandsRouter from "./wa-commands";
import vendorsRouter from "./vendors";
import vendorPortalRouter from "./vendor-portal";
import driverPortalRouter from "./driver-portal";
import systemRouter from "./system";
import companyGovernanceRouter from "./company-governance";
import { extractUser } from "../middleware/auth";

const router: IRouter = Router();

// Apply soft auth extraction to all routes (non-blocking)
router.use(extractUser);

// Auth routes (public)
router.use(authRouter);

// Application routes
router.use(healthRouter);
router.use(tasksRouter);
router.use(teamRouter);
router.use(messagesRouter);
// ── Sprint 9C — Document Validation (must come BEFORE documentsRouter to avoid GET /documents/:id conflict) ──
router.use(documentValidationRouter);
router.use(documentsRouter);
router.use(dashboardRouter);
router.use(whatsappRouter);
router.use(aiTasksRouter);
router.use(storageRouter);
router.use(attachmentsRouter);
router.use(auditsRouter);
router.use(publicRouter);
router.use(customersRouter);
router.use(notificationsRouter);
router.use(fonnteWebhookRouter);
router.use(exportRouter);
router.use(settingsRouter);
router.use(checklistsRouter);
router.use(quotationsRouter);
router.use(reportsRouter);
router.use(auditLogRouter);
router.use(shipmentRouter);
router.use(customersCrmRouter);
router.use(portalRouter);
router.use(dispatcherRouter);
router.use(knowledgeBaseRouter);
router.use(governanceRouter);
router.use(trainingRouter);
router.use(observabilityRouter);
router.use(customerMemoryRouter);
router.use(vendorMemoryRouter);
router.use(intelRouter);
router.use(purchasingRequestsRouter);
router.use(purchasingBenchmarkRouter);
router.use(purchasingBudgetRouter);
router.use(purchasingMarginRouter);
router.use(purchasingApprovalRouter);
router.use(executiveIntelligenceRouter);
// ── Sprint 8B — Executive Command Center ──────────────────────────────────────
router.use(executiveCommandRouter);
// ── Sprint 7B — Fleet Foundation ──────────────────────────────────────────────
router.use(fleetUnitsRouter);
router.use(fleetDriversRouter);
router.use(fleetDocumentsRouter);
router.use(fleetMaintenanceRouter);
// ── Sprint 7C — Fuel Intelligence, Tire Lifecycle, Utilization ────────────────
router.use(fleetFuelRouter);
router.use(fleetTiresRouter);
router.use(fleetUtilizationRouter);
// ── Sprint 7D — Fleet Risk, Cost, Dashboard, WhatsApp Reporting ───────────────
router.use(fleetRiskRouter);
router.use(fleetCostRouter);
router.use(fleetRouteProfitabilityRouter);
router.use(fleetDriverMemoryRouter);
router.use(fleetReportsRouter);
// ── AI Intake Sessions & Mini Form ────────────────────────────────────────────
router.use(intakeSessionsRouter);
router.use(intakeFormRouter);
router.use(miniFormConfigRouter);
// ── Sprint 8D — Memory Readiness ──────────────────────────────────────────────
router.use(readinessRouter);
// ── Sprint 9D — Conversation Test Suite & AI Quality Gate ─────────────────────
router.use(conversationTestsRouter);
// ── Sprint 9D — Quality Gate & Certification ───────────────────────────────────
router.use(qualityGateRouter);
// ── Sprint 10A-1 — WhatsApp First Operations ──────────────────────────────────
router.use(waCommandsRouter);
// ── Sprint 10A-1.2 — Onboarding Readiness Hardening ───────────────────────────
router.use(vendorsRouter);
// ── Sprint 10A-3 — Vendor Self-Service Portal ──────────────────────────────────
router.use(vendorPortalRouter);
// ── Sprint 10A-4 — Driver Self-Service Portal ──────────────────────────────────
router.use(driverPortalRouter);
router.use(systemRouter);
// ── Sprint 10B-1 — Multi-Company Scaling Foundation ───────────────────────────
router.use(companyGovernanceRouter);

export default router;
