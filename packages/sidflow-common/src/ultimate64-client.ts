/**
 * Ultimate 64 REST API client
 * Based on doc/plans/scale/c64-rest-api.md
 */

import { createLogger } from "./logger.js";
import { readFile } from "node:fs/promises";

const logger = createLogger("ultimate64-client");

export interface Ultimate64Config {
  readonly host: string;
  readonly https?: boolean;
  readonly password?: string;
}

export interface SidplayOptions {
  readonly sidBuffer: Uint8Array;
  readonly songNumber?: number;
}

export interface StreamStartOptions {
  readonly stream: "audio" | "video" | "debug";
  readonly ip: string;
  readonly port?: number;
}

export interface ConfigItem {
  readonly current?: unknown;
  readonly min?: number;
  readonly max?: number;
  readonly format?: string;
  readonly default?: unknown;
}

export interface Ultimate64Response {
  readonly errors: string[];
  readonly [key: string]: unknown;
}

export class Ultimate64Client {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(config: Ultimate64Config) {
    const protocol = config.https ? "https" : "http";
    this.baseUrl = `${protocol}://${config.host}`;
    this.headers = {};

    if (config.password) {
      this.headers["X-Password"] = config.password;
    }
  }

  /**
   * Get Ultimate 64 version information
   */
  async getVersion(): Promise<Ultimate64Response> {
    return await this.get("/v1/version");
  }

  /**
   * Get Ultimate 64 device information
   */
  async getInfo(): Promise<Ultimate64Response> {
    return await this.get("/v1/info");
  }

  /**
   * Play a SID file on the Ultimate 64
   */
  async sidplay(options: SidplayOptions): Promise<Ultimate64Response> {
    const params = new URLSearchParams();
    if (options.songNumber !== undefined) {
      params.set("songnr", String(options.songNumber));
    }

    const url = `/v1/runners:sidplay${params.toString() ? `?${params.toString()}` : ""}`;

    return await this.post(url, options.sidBuffer);
  }

  /**
   * Start audio/video/debug stream
   */
  async startStream(options: StreamStartOptions): Promise<Ultimate64Response> {
    const defaultPorts = {
      video: 11000,
      audio: 11001,
      debug: 11002,
    };

    const port = options.port ?? defaultPorts[options.stream];
    const params = new URLSearchParams();
    params.set("ip", `${options.ip}:${port}`);

    const url = `/v1/streams/${options.stream}:start?${params.toString()}`;

    return await this.put(url);
  }

  /**
   * Stop audio/video/debug stream
   */
  async stopStream(stream: "audio" | "video" | "debug"): Promise<Ultimate64Response> {
    return await this.put(`/v1/streams/${stream}:stop`);
  }

  /**
   * Reset the C64 machine
   */
  async reset(): Promise<Ultimate64Response> {
    return await this.put("/v1/machine:reset");
  }

  /**
   * Get configuration categories
   */
  async getConfigCategories(): Promise<Ultimate64Response> {
    return await this.get("/v1/configs");
  }

  /**
   * Get configuration for a specific category
   */
  async getConfig(category: string): Promise<Ultimate64Response> {
    const encodedCategory = encodeURIComponent(category);
    return await this.get(`/v1/configs/${encodedCategory}`);
  }

  /**
   * Set a configuration item
   */
  async setConfig(
    category: string,
    item: string,
    value: string
  ): Promise<Ultimate64Response> {
    const encodedCategory = encodeURIComponent(category);
    const encodedItem = encodeURIComponent(item);
    const params = new URLSearchParams();
    params.set("value", value);

    const url = `/v1/configs/${encodedCategory}/${encodedItem}?${params.toString()}`;

    return await this.put(url);
  }

  /**
   * Set SID chip configuration (6581 or 8580R5)
   */
  async setSidChip(chip: "6581" | "8580r5"): Promise<void> {
    logger.debug(`Setting SID chip to ${chip}`);

    // Map chip to Ultimate 64 configuration value
    const chipValue = chip === "6581" ? "6581" : "8580R5";

    try {
      await this.setConfig("SID Sockets Configuration", "SID in Socket 1", chipValue);
      logger.debug(`SID chip set to ${chipValue}`);
    } catch (err) {
      logger.error(`Failed to set SID chip: ${err}`);
      throw err;
    }
  }

  /**
   * Execute HTTP GET request
   */
  private async get(path: string): Promise<Ultimate64Response> {
    const url = `${this.baseUrl}${path}`;
    logger.debug(`GET ${url}`);

    const response = await fetch(url, {
      method: "GET",
      headers: this.headers,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return (await response.json()) as Ultimate64Response;
  }

  /**
   * Execute HTTP PUT request
   */
  private async put(path: string, body?: Uint8Array): Promise<Ultimate64Response> {
    const url = `${this.baseUrl}${path}`;
    logger.debug(`PUT ${url}`);

    const response = await fetch(url, {
      method: "PUT",
      headers: this.headers,
      body: body as any,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return (await response.json()) as Ultimate64Response;
  }

  /**
   * Execute HTTP POST request
   */
  private async post(path: string, body?: Uint8Array): Promise<Ultimate64Response> {
    const url = `${this.baseUrl}${path}`;
    logger.debug(`POST ${url}`);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...this.headers,
        "Content-Type": "application/octet-stream",
      },
      body: body as any,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return (await response.json()) as Ultimate64Response;
  }
}
