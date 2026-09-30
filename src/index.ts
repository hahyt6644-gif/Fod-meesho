import { loadEnvFile } from "./lib/env";

loadEnvFile();

async function main() {
  if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is required (loaded from .env via loadEnvFile()).");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required (loaded from .env via loadEnvFile()).");
  }
  const { app } = await import("./app");
  const { sweepJobs } = await import("./lib/store");
  const port = Number(process.env.FOD_API_PORT || 2222);

  setInterval(sweepJobs, 60_000).unref();

  app.listen(port, () => {
    console.log(
      `[fod-api] listening on port ${port} — POST /start {mobile, threshold?}, POST /verify, GET /export/:job_id[.txt]`,
    );
  });
}

main().catch((err) => {
  console.error("[fod-api] fatal:", err?.message || err);
  process.exit(1);
});