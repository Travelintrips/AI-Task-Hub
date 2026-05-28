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

const router: IRouter = Router();

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

export default router;
