import { handle } from "hono/vercel";
import { app } from "../backend/src/app.js";

export default handle(app);
