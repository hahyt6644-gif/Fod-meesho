import { randomUUID } from "node:crypto";
import type { LockedFod, MeeshoSession, RequestContext } from "./fod-auth";
import type { JsonObject } from "./device";

export type FodJobStatus = "locked" | "otp_sent" | "verified" | "failed";

export type FodJob = {
  id: string;
  mobile: string;
  threshold: number;
  attempts: number;
  status: FodJobStatus;
  createdAt: number;
  locked: {
    offer: LockedFod;
    context: { requestContext: RequestContext; xo: string };
    identity: JsonObject;
  } | null;
  challengeId: string | null;
  error: string | null;
  session: MeeshoSession | null;
  validity: Record<string, unknown> | null;
};

const jobs = new Map<string, FodJob>();
const JOB_TTL_MS = 20 * 60_000;

export function createJob(mobile: string, threshold: number): FodJob {
  const job: FodJob = {
    id: randomUUID(),
    mobile,
    threshold,
    attempts: 0,
    status: "locked",
    createdAt: Date.now(),
    locked: null,
    challengeId: null,
    error: null,
    session: null,
    validity: null,
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): FodJob | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;
  if (job.createdAt + JOB_TTL_MS < Date.now()) {
    jobs.delete(id);
    return undefined;
  }
  return job;
}

export function clearJob(id: string) {
  jobs.delete(id);
}

export function sweepJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.createdAt + JOB_TTL_MS < now) jobs.delete(id);
  }
}