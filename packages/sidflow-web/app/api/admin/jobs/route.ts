/**
 * Admin API: Job management endpoints
 * GET: List all jobs
 * POST: Create a new job
 */

import { NextRequest, NextResponse } from "next/server";
import { JobOrchestrator, getDefaultAuditTrail } from "@sidflow/common";
import { loadConfig } from "@sidflow/common";
import path from "node:path";

let orchestrator: JobOrchestrator | null = null;

async function getOrchestrator(): Promise<JobOrchestrator> {
  if (!orchestrator) {
    const manifestPath = path.join(process.cwd(), "data", "jobs", "manifest.json");
    orchestrator = new JobOrchestrator({ manifestPath });
    await orchestrator.load();
  }
  return orchestrator;
}

const auditTrail = getDefaultAuditTrail();

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") as any;
    const status = searchParams.get("status") as any;

    const orch = await getOrchestrator();
    const filters: any = {};
    if (type) filters.type = type;
    if (status) filters.status = status;

    const jobs = orch.listJobs(Object.keys(filters).length > 0 ? filters : undefined);
    const stats = orch.getStatistics();

    return NextResponse.json({
      jobs,
      stats,
    });
  } catch (error) {
    console.error("Failed to list jobs:", error);
    return NextResponse.json(
      { error: "Failed to list jobs" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, params } = body;

    if (!type || !params) {
      return NextResponse.json(
        { error: "Missing type or params" },
        { status: 400 }
      );
    }

    const orch = await getOrchestrator();
    const job = await orch.createJob(type, params);

    await auditTrail.logSuccess("job:create", "admin", job.id, { type, params });

    return NextResponse.json({ job });
  } catch (error) {
    await auditTrail.logFailure(
      "job:create",
      "admin",
      String(error),
      undefined,
      { type }
    );
    console.error("Failed to create job:", error);
    return NextResponse.json(
      { error: "Failed to create job" },
      { status: 500 }
    );
  }
}
