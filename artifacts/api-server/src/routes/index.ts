import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tasksRouter from "./tasks";
import teamRouter from "./team";
import messagesRouter from "./messages";
import documentsRouter from "./documents";
import dashboardRouter from "./dashboard";
import whatsappRouter from "./whatsapp";
import aiTasksRouter from "./ai-tasks";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tasksRouter);
router.use(teamRouter);
router.use(messagesRouter);
router.use(documentsRouter);
router.use(dashboardRouter);
router.use(whatsappRouter);
router.use(aiTasksRouter);

export default router;
