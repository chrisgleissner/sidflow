/**
 * Admin API: Individual job operations
 * GET: Get job details
 * PATCH: Update job status/progress
 * DELETE: Delete job
 */

import { NextRequest, NextResponse } from "next/server";
import { getDefaultAuditTrail } from "@sidflow/common";
import { getJobOrchestrator } from '@/lib/server/jobs';

const auditTrail = getDefaultAuditTrail();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const orch = await getJobOrchestrator();
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

    const orch = await getJobOrchestrator();

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

    await auditTrail.logSuccess("job:update", "admin", id, { status, progress });

    const job = orch.getJob(id);
    return NextResponse.json({ job });
  } catch (error) {
    // Best-effort extraction of id for logging
    let jobId: string | undefined;
    try {
      jobId = (await params).id;
    } catch {}
    await auditTrail.logFailure("job:update", "admin", String(error), jobId);
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
    const orch = await getJobOrchestrator();

    await orch.deleteJob(id);

    await auditTrail.logSuccess("job:delete", "admin", id);

    return NextResponse.json({ success: true });
  } catch (error) {
    // Best-effort extraction of id for logging
    let jobId: string | undefined;
    try {
      jobId = (await params).id;
    } catch {}
    await auditTrail.logFailure("job:delete", "admin", String(error), jobId);
    console.error("Failed to delete job:", error);
    return NextResponse.json(
      { error: "Failed to delete job" },
      { status: 500 }
    );
  }
}
