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

export default router;
