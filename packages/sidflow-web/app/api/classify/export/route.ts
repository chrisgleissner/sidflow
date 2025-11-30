/**
 * Classification Export API endpoint
 * Exports all classification data (auto-tags.json files) to a single JSON file
 * for bootstrapping new deployments from local classification runs
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSidflowConfig } from '@/lib/server-env';
import type { ApiResponse } from '@/lib/validation';
import { promises as fs } from 'node:fs';
import path from 'node:path';

interface ClassificationEntry {
  e: number;
  m: number;
  c: number;
  p?: number;
  source: string;
}

interface ExportData {
  version: '1.0';
  exportedAt: string;
  classificationDepth: number;
  totalEntries: number;
  classifications: Record<string, ClassificationEntry>;
}

/**
 * Recursively finds all auto-tags.json files and merges them into a single object.
 * Uses parallel processing for better performance on large collections.
 */
async function collectAllClassifications(tagsPath: string): Promise<Record<string, ClassificationEntry>> {
  const allClassifications: Record<string, ClassificationEntry> = {};
  
  async function walkDir(dir: string, relativePath: string = ''): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // Directory doesn't exist or not readable
    }
    
    // Process entries in parallel for better performance
    const promises = entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        const newRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        await walkDir(fullPath, newRelativePath);
      } else if (entry.name === 'auto-tags.json') {
        try {
          const content = await fs.readFile(fullPath, 'utf8');
          const tags = JSON.parse(content) as Record<string, ClassificationEntry>;
          
          // Prefix each key with the relative path
          for (const [key, value] of Object.entries(tags)) {
            const fullKey = relativePath ? `${relativePath}/${key}` : key;
            allClassifications[fullKey] = value;
          }
        } catch (error) {
          console.warn(`[export] Failed to read ${fullPath}: ${(error as Error).message}`);
        }
      }
    });
    
    await Promise.all(promises);
  }
  
  await walkDir(tagsPath);
  return allClassifications;
}

/**
 * GET /api/classify/export - Export all classifications as a downloadable JSON file
 */
export async function GET() {
  try {
    const config = await getSidflowConfig();
    const tagsPath = config.tagsPath;
    
    console.log(`[export] Collecting classifications from ${tagsPath}`);
    const classifications = await collectAllClassifications(tagsPath);
    const entryCount = Object.keys(classifications).length;
    
    if (entryCount === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'No classifications found',
        details: 'Run classification first to generate data for export.',
      };
      return NextResponse.json(response, { status: 404 });
    }
    
    const exportData: ExportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      classificationDepth: config.classificationDepth,
      totalEntries: entryCount,
      classifications,
    };
    
    console.log(`[export] Exporting ${entryCount} classification entries`);
    
    // Return as downloadable JSON file
    const jsonContent = JSON.stringify(exportData, null, 2);
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    headers.set('Content-Disposition', `attachment; filename="sidflow-classifications-${new Date().toISOString().split('T')[0]}.json"`);
    headers.set('Content-Length', String(Buffer.byteLength(jsonContent)));
    
    return new NextResponse(jsonContent, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error('[export] Error exporting classifications:', error);
    const response: ApiResponse = {
      success: false,
      error: 'Failed to export classifications',
      details: error instanceof Error ? error.message : String(error),
    };
    return NextResponse.json(response, { status: 500 });
  }
}

/**
 * POST /api/classify/export - Import classifications from uploaded JSON file
 * 
 * Request body should be the ExportData JSON
 * Uses a two-phase approach: prepare all content first, then write atomically
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as ExportData;
    
    // Validate the import data
    if (!body.version || body.version !== '1.0') {
      throw new Error(`Invalid or unsupported export version: ${body.version}. Expected version 1.0`);
    }
    
    if (!body.classifications || typeof body.classifications !== 'object') {
      throw new Error('Missing or invalid classifications data');
    }
    
    const config = await getSidflowConfig();
    const tagsPath = config.tagsPath;
    const depth = config.classificationDepth;
    
    console.log(`[import] Importing ${Object.keys(body.classifications).length} classification entries`);
    
    // Group classifications by their auto-tags.json file location
    const groupedByFile = new Map<string, Record<string, ClassificationEntry>>();
    
    for (const [fullPath, entry] of Object.entries(body.classifications)) {
      // Parse the path to determine the auto-tags.json location
      const segments = fullPath.split('/');
      
      // Determine directory based on classification depth
      const dirSegments = segments.slice(0, Math.min(depth, segments.length - 1));
      const key = segments.slice(dirSegments.length).join('/');
      
      const autoTagsDir = path.join(tagsPath, ...dirSegments);
      const autoTagsFile = path.join(autoTagsDir, 'auto-tags.json');
      
      let fileEntries = groupedByFile.get(autoTagsFile);
      if (!fileEntries) {
        fileEntries = {};
        groupedByFile.set(autoTagsFile, fileEntries);
      }
      
      fileEntries[key] = entry;
    }
    
    // Phase 1: Prepare all content (read existing files and merge)
    const preparedWrites: Array<{ filePath: string; content: string; entriesCount: number }> = [];
    const successfullyWritten: string[] = [];
    
    for (const [filePath, entries] of groupedByFile) {
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      
      // Merge with existing entries if file exists
      let existingEntries: Record<string, ClassificationEntry> = {};
      try {
        const content = await fs.readFile(filePath, 'utf8');
        existingEntries = JSON.parse(content);
      } catch {
        // File doesn't exist or is invalid, start fresh
      }
      
      const mergedEntries = { ...existingEntries, ...entries };
      
      // Sort keys for deterministic output
      const sortedEntries: Record<string, ClassificationEntry> = {};
      for (const key of Object.keys(mergedEntries).sort()) {
        sortedEntries[key] = mergedEntries[key];
      }
      
      preparedWrites.push({
        filePath,
        content: JSON.stringify(sortedEntries, null, 2),
        entriesCount: Object.keys(entries).length,
      });
    }
    
    // Phase 2: Write all files
    let filesWritten = 0;
    let entriesWritten = 0;
    
    try {
      for (const { filePath, content, entriesCount } of preparedWrites) {
        await fs.writeFile(filePath, content);
        successfullyWritten.push(filePath);
        filesWritten++;
        entriesWritten += entriesCount;
      }
    } catch (writeError) {
      // If a write fails, report which files were successfully written
      console.error('[import] Write failed after successfully writing:', successfullyWritten);
      throw new Error(
        `Import partially failed: ${(writeError as Error).message}. ` +
        `Successfully wrote ${successfullyWritten.length} files before failure.`
      );
    }
    
    console.log(`[import] Wrote ${entriesWritten} entries to ${filesWritten} auto-tags.json files`);
    
    const response: ApiResponse<{ filesWritten: number; entriesWritten: number }> = {
      success: true,
      data: {
        filesWritten,
        entriesWritten,
      },
    };
    
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('[import] Error importing classifications:', error);
    const response: ApiResponse = {
      success: false,
      error: 'Failed to import classifications',
      details: error instanceof Error ? error.message : String(error),
    };
    return NextResponse.json(response, { status: 400 });
  }
}
