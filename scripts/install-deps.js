#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const shimDir = path.join(process.cwd(), 'scripts', 'shims');
const existingNodePath = process.env.NODE_PATH ? process.env.NODE_PATH.split(path.delimiter) : [];
const nodePath = [shimDir, ...existingNodePath.filter(Boolean)];
const env = {
  ...process.env,
  NODE_PATH: nodePath.join(path.delimiter),
  npm_config_registry: process.env.npm_config_registry || 'https://registry.npmmirror.com',
  NPM_CONFIG_REGISTRY: process.env.NPM_CONFIG_REGISTRY || 'https://registry.npmmirror.com',
  BUN_INSTALL_REGISTRY: process.env.BUN_INSTALL_REGISTRY || 'https://registry.npmmirror.com',
  BUN_INSTALL_IGNORE_SCRIPTS: process.env.BUN_INSTALL_IGNORE_SCRIPTS || '1',
  npm_config_ignore_scripts: process.env.npm_config_ignore_scripts || 'true',
  NPM_CONFIG_IGNORE_SCRIPTS: process.env.NPM_CONFIG_IGNORE_SCRIPTS || 'true',
};

const installArgs = ['install', '--frozen-lockfile', '--ignore-scripts'];
const result = spawnSync('bun', installArgs, {
  stdio: 'inherit',
  env,
});

if (result.error || result.status !== 0) {
  if (result.error) {
    console.error(result.error);
  }
  console.warn('bun install failed, falling back to npm install');
  const npmArgs = ['install', '--no-audit', '--no-fund', '--registry=https://registry.npmmirror.com', '--ignore-scripts'];
  const npmResult = spawnSync('npm', npmArgs, {
    stdio: 'inherit',
    env,
  });
  if (npmResult.error) {
    console.error(npmResult.error);
    process.exit(1);
  }
  process.exit(npmResult.status ?? 1);
}

process.exit(result.status ?? 1);
