/**
 * Admin API: Individual job operations
 * GET: Get job details
 * PATCH: Update job status/progress
 * DELETE: Delete job
 */

import { NextRequest, NextResponse } from "next/server";
import { JobOrchestrator } from "@sidflow/common";
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const orch = await getOrchestrator();
    const job = orch.getJob(id);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json({ job });
  } catch (error) {
    console.error("Failed to get job:", error);
    return NextResponse.json({ error: "Failed to get job" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { status, progress } = body;

    const orch = await getOrchestrator();

    if (status) {
      await orch.updateJobStatus(id, status, body.metadata);
    }

    if (progress) {
      await orch.updateJobProgress(
        id,
        progress.current,
        progress.total,
        progress.message
      );
    }

    const job = orch.getJob(id);
    return NextResponse.json({ job });
  } catch (error) {
    console.error("Failed to update job:", error);
    return NextResponse.json(
      { error: "Failed to update job" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const orch = await getOrchestrator();

    await orch.deleteJob(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete job:", error);
    return NextResponse.json(
      { error: "Failed to delete job" },
      { status: 500 }
    );
  }
}
