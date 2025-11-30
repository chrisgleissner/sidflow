/**
 * Scheduler API endpoint - manages nightly fetch + classify scheduling
 */
import { NextRequest, NextResponse } from 'next/server';
import { getWebPreferences, updateWebPreferences, type SchedulerConfig, type RenderPreferences } from '@/lib/preferences-store';
import { getSchedulerStatus, restartScheduler } from '@/lib/scheduler';
import type { ApiResponse } from '@/lib/validation';

interface SchedulerResponse {
  scheduler: SchedulerConfig;
  renderPrefs: RenderPreferences;
  status: ReturnType<typeof getSchedulerStatus>;
}

/**
 * GET /api/scheduler - Get current scheduler configuration and status
 */
export async function GET() {
  try {
    const prefs = await getWebPreferences();
    const status = getSchedulerStatus();
    
    const response: ApiResponse<SchedulerResponse> = {
      success: true,
      data: {
        scheduler: prefs.scheduler ?? {
          enabled: false,
          time: '06:00',
          timezone: 'UTC',
        },
        renderPrefs: prefs.renderPrefs ?? {
          preserveWav: true,
          enableFlac: false,
          enableM4a: false,
        },
        status,
      },
    };
    
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    const response: ApiResponse = {
      success: false,
      error: 'Failed to get scheduler configuration',
      details: error instanceof Error ? error.message : String(error),
    };
    return NextResponse.json(response, { status: 500 });
  }
}

/**
 * POST /api/scheduler - Update scheduler configuration
 * 
 * Request body:
 * {
 *   scheduler?: { enabled?: boolean, time?: string, timezone?: string },
 *   renderPrefs?: { preserveWav?: boolean, enableFlac?: boolean, enableM4a?: boolean }
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const currentPrefs = await getWebPreferences();
    
    // Validate and normalize scheduler config
    let schedulerUpdate: SchedulerConfig | undefined;
    if (body.scheduler !== undefined) {
      const scheduler = body.scheduler;
      
      // Validate enabled
      if (scheduler.enabled !== undefined && typeof scheduler.enabled !== 'boolean') {
        throw new Error('scheduler.enabled must be a boolean');
      }
      
      // Validate time format
      if (scheduler.time !== undefined) {
        if (typeof scheduler.time !== 'string') {
          throw new Error('scheduler.time must be a string');
        }
        const timeMatch = scheduler.time.match(/^(\d{1,2}):(\d{2})$/);
        if (!timeMatch) {
          throw new Error('scheduler.time must be in HH:MM format');
        }
        const hours = parseInt(timeMatch[1], 10);
        const minutes = parseInt(timeMatch[2], 10);
        if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
          throw new Error('scheduler.time has invalid hours or minutes');
        }
      }
      
      // Validate timezone
      if (scheduler.timezone !== undefined) {
        if (typeof scheduler.timezone !== 'string') {
          throw new Error('scheduler.timezone must be a string');
        }
        // For now, we only fully support UTC
        // Other timezones will use local time as approximation
      }
      
      schedulerUpdate = {
        enabled: scheduler.enabled ?? currentPrefs.scheduler?.enabled ?? false,
        time: scheduler.time ?? currentPrefs.scheduler?.time ?? '06:00',
        timezone: scheduler.timezone ?? currentPrefs.scheduler?.timezone ?? 'UTC',
      };
    }
    
    // Validate and normalize render preferences
    let renderPrefsUpdate: RenderPreferences | undefined;
    if (body.renderPrefs !== undefined) {
      const renderPrefs = body.renderPrefs;
      
      if (renderPrefs.preserveWav !== undefined && typeof renderPrefs.preserveWav !== 'boolean') {
        throw new Error('renderPrefs.preserveWav must be a boolean');
      }
      if (renderPrefs.enableFlac !== undefined && typeof renderPrefs.enableFlac !== 'boolean') {
        throw new Error('renderPrefs.enableFlac must be a boolean');
      }
      if (renderPrefs.enableM4a !== undefined && typeof renderPrefs.enableM4a !== 'boolean') {
        throw new Error('renderPrefs.enableM4a must be a boolean');
      }
      
      renderPrefsUpdate = {
        preserveWav: renderPrefs.preserveWav ?? currentPrefs.renderPrefs?.preserveWav ?? true,
        enableFlac: renderPrefs.enableFlac ?? currentPrefs.renderPrefs?.enableFlac ?? false,
        enableM4a: renderPrefs.enableM4a ?? currentPrefs.renderPrefs?.enableM4a ?? false,
      };
    }
    
    // Check if any updates were provided
    if (schedulerUpdate === undefined && renderPrefsUpdate === undefined) {
      throw new Error('No scheduler or renderPrefs updates provided');
    }
    
    // Apply updates
    const updates: Partial<typeof currentPrefs> = {};
    if (schedulerUpdate !== undefined) {
      updates.scheduler = schedulerUpdate;
    }
    if (renderPrefsUpdate !== undefined) {
      updates.renderPrefs = renderPrefsUpdate;
    }
    
    const updatedPrefs = await updateWebPreferences(updates);
    
    // Restart scheduler if configuration changed
    if (schedulerUpdate !== undefined) {
      await restartScheduler();
    }
    
    const status = getSchedulerStatus();
    
    const response: ApiResponse<SchedulerResponse> = {
      success: true,
      data: {
        scheduler: updatedPrefs.scheduler ?? {
          enabled: false,
          time: '06:00',
          timezone: 'UTC',
        },
        renderPrefs: updatedPrefs.renderPrefs ?? {
          preserveWav: true,
          enableFlac: false,
          enableM4a: false,
        },
        status,
      },
    };
    
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    const response: ApiResponse = {
      success: false,
      error: 'Failed to update scheduler configuration',
      details: error instanceof Error ? error.message : String(error),
    };
    return NextResponse.json(response, { status: 400 });
  }
}
