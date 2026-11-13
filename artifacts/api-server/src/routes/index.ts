import { Router, type IRouter } from "express";
import healthRouter from "./health";
import meechainRouter from "./meechain";

const router: IRouter = Router();

router.use(healthRouter);
router.use(meechainRouter);

export default router;
