import path from "path";
import fs from "fs";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { app } from "./app.js";

// Serve frontend static build in production
const staticDir = path.resolve(import.meta.dirname, "..", "..", "frontend", "dist");
if (fs.existsSync(staticDir)) {
  const root = path.relative(process.cwd(), staticDir) + "/";
  app.use("/*", serveStatic({ root }));
  app.get("*", (c) => {
    return c.html(fs.readFileSync(path.join(staticDir, "index.html"), "utf-8"));
  });
}

const port = Number(process.env.PORT ?? 8000);
console.log(`Starting Bay Wheels API on port ${port}...`);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(`API running at http://localhost:${info.port}`);
});
