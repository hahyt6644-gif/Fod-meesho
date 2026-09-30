import express from "express";
import {
  createAnonymousContext,
  fetchAnonymousFod,
  requestOtp,
  verifyOtp,
  checkFodValidity,
  type LockedFod,
  type RequestContext,
} from "./lib/fod-auth";
import { createJob, getJob, clearJob } from "./lib/store";
import { getMeeshoAuthConfig } from "./lib/config";
import { randomDeviceIdentity, type JsonObject } from "./lib/device";

const app = express();
app.use(express.json({ limit: "1mb" }));

export type FodContext = { requestContext: RequestContext; xo: string };

const DEFAULT_THRESHOLD = 200;
const MAX_ROLLS = 30;
const MAX_JOB_AGE_MS = 20 * 60_000;

function mobileDigits(value: unknown) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("91")) {
    digits = digits.slice(2);
  }
  return digits.length === 10 ? digits : "";
}

function maskMobile(mobile: string) {
  if (mobile.length !== 10) return mobile;
  return `${mobile.slice(0, 4)}••••${mobile.slice(-2)}`;
}

async function rollUntilThreshold(
  threshold: number,
): Promise<{
  offer: LockedFod;
  context: FodContext;
  identity: JsonObject;
  attempts: number;
}> {
  let lastOffer: LockedFod | null = null;
  for (let roll = 0; roll < MAX_ROLLS; roll += 1) {
    const identity = randomDeviceIdentity();
    const context: FodContext = await createAnonymousContext(identity);
    const result = await fetchAnonymousFod(identity, context);
    const offer = result.offer;
    lastOffer = offer;
    if (offer.bucket !== null && offer.bucket >= threshold) {
      return { offer, context: result.context, identity, attempts: roll + 1 };
    }
  }
  throw new Error(
    `FOD stayed below ₹${threshold} after ${MAX_ROLLS} rolls (last seen: ₹${lastOffer?.bucket ?? "none"}).`,
  );
}

app.get("/", (_req, res) => {
  res.json({
    service: "fod-api",
    status: "ok",
    port: 2222,
    endpoints: {
      start: "POST /start  { mobile, threshold? }  -> simple FOD fetch (no re-roll), lock >= threshold, send OTP",
      verify: "POST /verify  { job_id, otp }  -> validate OTP, login, apply + check FOD",
      check: "GET /check/:job_id  -> current job state (what {number} OTP is pending on)",
      export: "GET /export/:job_id  -> full result JSON (client saves)",
      export_txt: "GET /export/:job_id.txt  -> full result as a browser-downloadable .txt",
      fod: "GET /fod/:mobile  -> read-only FOD report for a number (no OTP)",
      health: "GET /health",
    },
  });
});

app.get("/health", async (_req, res) => {
  try {
    await getMeeshoAuthConfig();
    res.json({ ok: true, auth: "configured" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ ok: false, auth: "missing", error: message });
  }
});

app.post("/start", async (req, res) => {
  try {
    const mobile = mobileDigits(req.body?.mobile);
    if (!mobile) {
      res.status(400).json({ ok: false, error: "Enter a valid 10-digit mobile number." });
      return;
    }
    let threshold = Number(req.body?.threshold);
    if (!Number.isFinite(threshold) || threshold <= 0) threshold = DEFAULT_THRESHOLD;

    const job = createJob(mobile, Math.floor(threshold));

    let resolved;
    try {
      resolved = await rollUntilThreshold(job.threshold);
      job.locked = {
        offer: resolved.offer,
        context: { requestContext: resolved.context.requestContext, xo: resolved.context.xo },
        identity: resolved.identity,
      };
      job.attempts = resolved.attempts;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      job.status = "failed";
      job.error = message;
      clearJob(job.id);
      res.status(422).json({ ok: false, error: message });
      return;
    }

    let challengeId: string;
    try {
      challengeId = (await requestOtp(mobile, job.locked.identity, job.locked.context)).challengeId;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      job.status = "failed";
      job.error = message;
      clearJob(job.id);
      res.status(502).json({
        ok: false,
        error: `FOD locked at ₹${job.locked.offer.bucket ?? "-"} but OTP could not be sent: ${message}`,
        locked_offer: job.locked.offer,
      });
      return;
    }

    job.challengeId = challengeId;
    job.status = "otp_sent";
    res.json({
      ok: true,
      job_id: job.id,
      status: "otp_sent",
      number: mobile,
      number_masked: maskMobile(mobile),
      threshold: job.threshold,
      attempts: job.attempts,
      fod: job.locked.offer,
      message: `FOD locked at ₹${job.locked.offer.bucket ?? "-"}. OTP sent to ${maskMobile(mobile)}.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message });
  }
});

app.get("/check/:jobId", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ ok: false, error: "Job not found or expired." });
    return;
  }
  res.json({
    ok: true,
    job_id: job.id,
    status: job.status,
    number: job.mobile,
    number_masked: maskMobile(job.mobile),
    number_field_note: `Send OTP to the number ${maskMobile(job.mobile)} (this is the {number})`,
    fod: job.locked?.offer ?? null,
    attempts: job.attempts,
    error: job.error,
  });
});

app.post("/verify", async (req, res) => {
  const jobId = String(req.body?.job_id ?? "");
  const otp = String(req.body?.otp ?? "").trim();
  const job = getJob(jobId);
  if (!job) {
    res.status(404).json({ ok: false, error: "Job not found or expired. Start again." });
    return;
  }
  if (!job.challengeId || job.status !== "otp_sent") {
    res.status(400).json({
      ok: false,
      error: `Job is in "${job.status}" state; OTP has not been requested for it.`,
    });
    return;
  }
  if (!otp) {
    res.status(400).json({
      ok: false,
      error: `Enter the OTP sent to ${maskMobile(job.mobile)}.`,
    });
    return;
  }

  let session;
  try {
    session = await verifyOtp(job.challengeId, otp);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(401).json({ ok: false, error: `OTP validation failed: ${message}` });
    return;
  }
  job.session = session;

  let validity;
  try {
    validity = await checkFodValidity(session);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    job.validity = { error: message };
    job.status = "verified";
    const sessionSummary = {
      mobile: session.mobile,
      user_id: session.userId,
      token: session.xo,
      context: session.context,
    };
    res.json({
      ok: true,
      status: "verified",
      job_id: job.id,
      number: job.mobile,
      fod_locked_at: job.locked?.offer ?? null,
      session: sessionSummary,
      validity: { error: message },
      note: "Login succeeded but FOD validity check failed.",
    });
    return;
  }
  job.validity = validity as Record<string, unknown>;
  job.status = "verified";

  const fodValid = validity.offer.bucket !== null &&
    validity.offer.bucket >= job.threshold;

  const sessionSummary = {
    mobile: session.mobile,
    user_id: session.userId,
    token: session.xo,
    context: session.context,
  };

  res.json({
    ok: true,
    status: "verified",
    job_id: job.id,
    number: job.mobile,
    fod_locked_at: job.locked?.offer ?? null,
    fod_valid: fodValid,
    fod_valid_note: fodValid
      ? `FOD on this account is ₹${validity.offer.bucket ?? "?"} (>= ₹${job.threshold}) — valid.`
      : `FOD on this account is ₹${validity.offer.bucket ?? "?"} (< ₹${job.threshold}) — below threshold.`,
    session: sessionSummary,
    validity: {
      offer: validity.offer,
      applied: validity.applied,
      is_first_order: validity.is_first_order,
    },
  });
});

app.get("/export/:jobId", (req, res) => {
  const asText = req.params.jobId.endsWith(".txt");
  const id = asText ? req.params.jobId.slice(0, -4) : req.params.jobId;
  const job = getJob(id);
  if (!job) {
    res.status(404).json({ ok: false, error: "Job not found or expired." });
    return;
  }
  const payload = {
    ok: true,
    service: "fod-api",
    job_id: job.id,
    number: job.mobile,
    number_masked: maskMobile(job.mobile),
    threshold: job.threshold,
    status: job.status,
    attempts: job.attempts,
    created_at: new Date(job.createdAt).toISOString(),
    locked_fod: job.locked?.offer ?? null,
    error: job.error,
    session: job.session
      ? {
          mobile: job.session.mobile,
          user_id: job.session.userId,
          token: job.session.xo,
          context: job.session.context,
        }
      : null,
    validity: job.validity,
    fod_valid:
      job.validity && typeof job.validity.offer === "object" && job.validity.offer
        ? (job.validity.offer as unknown as LockedFod).bucket !== null &&
          (job.validity.offer as unknown as LockedFod).bucket !== undefined &&
          Number((job.validity.offer as unknown as LockedFod).bucket) >= job.threshold
        : null,
  };
  if (asText) {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="fod-result-${job.id}.txt"`,
    );
    res.send(
      `FOD RESULT (${new Date().toISOString()})\n` +
        `================================================\n` +
        `${JSON.stringify(payload, null, 2)}\n`,
    );
    return;
  }
  res.json(payload);
});

app.get("/fod/:mobile", async (req, res) => {
  try {
    const mobile = mobileDigits(req.params.mobile);
    if (!mobile) {
      res.status(400).json({ ok: false, error: "Enter a valid 10-digit mobile number." });
      return;
    }
    const threshold = Number(req.query.threshold) || DEFAULT_THRESHOLD;
    const identity: JsonObject = randomDeviceIdentity();
    const context = await createAnonymousContext(identity);
    const result = await fetchAnonymousFod(identity, context);
    res.json({
      ok: true,
      number: mobile,
      number_masked: maskMobile(mobile),
      threshold,
      fod: result.offer,
      valid: result.offer.bucket !== null && result.offer.bucket >= threshold,
      note: "Read-only anonymous FOD report (no OTP / no login).",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message });
  }
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ ok: false, error: err?.message || "Internal error." });
});

export { app };