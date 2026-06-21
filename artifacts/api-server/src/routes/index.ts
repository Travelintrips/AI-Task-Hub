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

export default router;
