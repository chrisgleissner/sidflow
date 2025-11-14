'use client';

import { useEffect, useState, useCallback } from 'react';
import type { JobDescriptor, JobType, JobStatus, RenderEngine } from '@sidflow/common';

type RenderFormat = 'wav' | 'm4a' | 'flac';
type RenderEngineSelection = 'auto' | RenderEngine;

interface JobsTabProps {
  onStatusChange: (status: string, isError?: boolean) => void;
}

interface JobStats {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  paused: number;
}

export function JobsTab({ onStatusChange }: JobsTabProps) {
  const [jobs, setJobs] = useState<JobDescriptor[]>([]);
  const [stats, setStats] = useState<JobStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<{ type?: JobType; status?: JobStatus }>({});
  const [renderEngine, setRenderEngine] = useState<RenderEngineSelection>('auto');
  const [renderFormats, setRenderFormats] = useState<RenderFormat[]>(['wav', 'm4a']);
  const [renderDurationSeconds, setRenderDurationSeconds] = useState(120);
  const [renderMaxLoss, setRenderMaxLoss] = useState(0.01);

  const renderFormatOptions: RenderFormat[] = ['wav', 'm4a', 'flac'];

  const renderJobParams = {
    engine: renderEngine,
    formats: renderFormats.length > 0 ? renderFormats : (['wav'] as RenderFormat[]),
    targetDurationMs: Math.round(Math.max(1, renderDurationSeconds) * 1000),
    maxLossRate: Math.max(0, Math.min(0.5, renderMaxLoss)),
  };

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter.type) params.set('type', filter.type);
      if (filter.status) params.set('status', filter.status);

      const response = await fetch(`/api/admin/jobs?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      setJobs(data.jobs || []);
      setStats(data.stats || null);
      onStatusChange(`Loaded ${data.jobs?.length || 0} jobs`, false);
    } catch (error) {
      onStatusChange(`Failed to load jobs: ${error}`, true);
    } finally {
      setLoading(false);
    }
  }, [filter, onStatusChange]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const createJob = async (type: JobType, params: any) => {
    try {
      const response = await fetch('/api/admin/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, params }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      onStatusChange(`Created ${type} job`, false);
      await fetchJobs();
    } catch (error) {
      onStatusChange(`Failed to create job: ${error}`, true);
    }
  };

  const deleteJob = async (id: string) => {
    try {
      const response = await fetch(`/api/admin/jobs/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      onStatusChange('Job deleted', false);
      await fetchJobs();
    } catch (error) {
      onStatusChange(`Failed to delete job: ${error}`, true);
    }
  };

  const toggleRenderFormat = (format: RenderFormat) => {
    setRenderFormats((current) =>
      current.includes(format)
        ? current.filter((entry) => entry !== format)
        : [...current, format]
    );
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Jobs</h2>
        <button
          onClick={() => fetchJobs()}
          disabled={loading}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Statistics */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded">
            <div className="text-sm text-gray-600 dark:text-gray-400">Total</div>
            <div className="text-2xl font-bold">{stats.total}</div>
          </div>
          <div className="bg-yellow-100 dark:bg-yellow-900 p-4 rounded">
            <div className="text-sm text-gray-600 dark:text-gray-400">Pending</div>
            <div className="text-2xl font-bold">{stats.pending}</div>
          </div>
          <div className="bg-blue-100 dark:bg-blue-900 p-4 rounded">
            <div className="text-sm text-gray-600 dark:text-gray-400">Running</div>
            <div className="text-2xl font-bold">{stats.running}</div>
          </div>
          <div className="bg-green-100 dark:bg-green-900 p-4 rounded">
            <div className="text-sm text-gray-600 dark:text-gray-400">Completed</div>
            <div className="text-2xl font-bold">{stats.completed}</div>
          </div>
          <div className="bg-red-100 dark:bg-red-900 p-4 rounded">
            <div className="text-sm text-gray-600 dark:text-gray-400">Failed</div>
            <div className="text-2xl font-bold">{stats.failed}</div>
          </div>
          <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded">
            <div className="text-sm text-gray-600 dark:text-gray-400">Paused</div>
            <div className="text-2xl font-bold">{stats.paused}</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-4">
        <select
          value={filter.type || ''}
          onChange={(e) => setFilter({ ...filter, type: (e.target.value || undefined) as JobType | undefined })}
          className="px-3 py-2 border rounded"
        >
          <option value="">All Types</option>
          <option value="fetch">Fetch</option>
          <option value="classify">Classify</option>
          <option value="train">Train</option>
          <option value="render">Render</option>
          <option value="pipeline">Pipeline</option>
        </select>

        <select
          value={filter.status || ''}
          onChange={(e) => setFilter({ ...filter, status: e.target.value as JobStatus || undefined })}
          className="px-3 py-2 border rounded"
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="paused">Paused</option>
        </select>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-2">
        <button
          onClick={() => createJob('fetch', {})}
          className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
        >
          Create Fetch Job
        </button>
        <button
          onClick={() => createJob('classify', { sidPaths: [] })}
          className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
        >
          Create Classify Job
        </button>
        <button
          onClick={() => createJob('train', {})}
          className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
        >
          Create Train Job
        </button>
        <button
          onClick={() => createJob('render', renderJobParams)}
          className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
        >
          Create Render Job
        </button>
        <button
          onClick={() =>
            createJob('pipeline', {
              allowResume: true,
              stages: [
                { type: 'fetch', label: 'Fetch HVSC' },
                { type: 'classify', label: 'Classify Library' },
                { type: 'train', label: 'Train Model' },
                { type: 'render', label: 'Render Assets', params: renderJobParams },
              ],
            })
          }
          className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600"
        >
          Run Full Pipeline
        </button>
      </div>

      {/* Render Controls */}
      <div className="border rounded p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Render Configuration</h3>
          <span className="text-sm text-gray-500">Applies to Render jobs and the pipeline stage</span>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col text-sm font-medium gap-1">
            Render Engine
            <select
              value={renderEngine}
              onChange={(event) => setRenderEngine(event.target.value as 'auto' | RenderEngine)}
              className="px-3 py-2 border rounded"
            >
              <option value="auto">Auto (fallback)</option>
              <option value="wasm">WASM (local)</option>
              <option value="sidplayfp-cli">sidplayfp CLI</option>
              <option value="ultimate64">Ultimate 64</option>
            </select>
          </label>
          <label className="flex flex-col text-sm font-medium gap-1">
            Target Duration (seconds)
            <input
              type="number"
              min={15}
              value={renderDurationSeconds}
              onChange={(event) => setRenderDurationSeconds(Number(event.target.value) || 60)}
              className="px-3 py-2 border rounded w-32"
            />
          </label>
          <label className="flex flex-col text-sm font-medium gap-1">
            Max Packet Loss
            <input
              type="number"
              min={0}
              max={0.5}
              step={0.01}
              value={renderMaxLoss}
              onChange={(event) => setRenderMaxLoss(Number(event.target.value) || 0)}
              className="px-3 py-2 border rounded w-32"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-4 items-center">
          <span className="text-sm font-medium">Formats</span>
          {renderFormatOptions.map((format) => (
            <label key={format} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={renderFormats.includes(format)}
                onChange={() => toggleRenderFormat(format)}
              />
              {format.toUpperCase()}
            </label>
          ))}
        </div>
      </div>

      {/* Job List */}
      <div className="space-y-2">
        {jobs.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No jobs found</div>
        ) : (
          jobs.map((job) => (
            <div
              key={job.id}
              className="border rounded p-4 bg-white dark:bg-gray-800"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-gray-500">{job.id}</span>
                    <span className="px-2 py-1 text-xs font-semibold rounded bg-blue-100 dark:bg-blue-900">
                      {job.type}
                    </span>
                    <span
                      className={`px-2 py-1 text-xs font-semibold rounded ${
                        job.status === 'completed'
                          ? 'bg-green-100 dark:bg-green-900'
                          : job.status === 'failed'
                          ? 'bg-red-100 dark:bg-red-900'
                          : job.status === 'running'
                          ? 'bg-blue-100 dark:bg-blue-900'
                          : 'bg-gray-100 dark:bg-gray-900'
                      }`}
                    >
                      {job.status}
                    </span>
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    Created: {new Date(job.metadata.createdAt).toLocaleString()}
                  </div>
                  {job.metadata.progress && (
                    <div className="mt-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded h-2">
                          <div
                            className="bg-blue-500 h-2 rounded"
                            style={{
                              width: `${(job.metadata.progress.current / job.metadata.progress.total) * 100}%`,
                            }}
                          />
                        </div>
                        <span className="text-sm">
                          {job.metadata.progress.current} / {job.metadata.progress.total}
                        </span>
                      </div>
                      {job.metadata.progress.message && (
                        <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                          {job.metadata.progress.message}
                        </div>
                      )}
                    </div>
                  )}
                  {job.metadata.error && (
                    <div className="mt-2 text-sm text-red-600 dark:text-red-400">
                      Error: {job.metadata.error}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => deleteJob(job.id)}
                  className="ml-4 px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600"
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
