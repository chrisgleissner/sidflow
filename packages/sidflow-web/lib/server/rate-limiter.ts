/**
 * Rate limiting implementation using sliding window algorithm.
 * Tracks requests per client IP and enforces configurable thresholds.
 */

export interface RateLimitConfig {
  /**
   * Maximum requests allowed per window (default: 100)
   */
  maxRequests: number;

  /**
   * Time window in milliseconds (default: 60000 = 1 minute)
   */
  windowMs: number;

  /**
   * Skip rate limiting for specific IPs (default: ['127.0.0.1', '::1'])
   */
  skipIps?: string[];
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
}

interface RequestLog {
  timestamps: number[];
}

/**
 * In-memory rate limiter using sliding window algorithm.
 * Production deployments should use Redis or similar for distributed rate limiting.
 */
export class RateLimiter {
  private logs: Map<string, RequestLog> = new Map();
  private config: Required<RateLimitConfig>;

  constructor(config: RateLimitConfig) {
    this.config = {
      maxRequests: config.maxRequests,
      windowMs: config.windowMs,
      skipIps: config.skipIps ?? ['127.0.0.1', '::1'],
    };
  }

  /**
   * Check if request should be allowed and update rate limit state.
   */
  check(clientIp: string): RateLimitResult {
    // Skip rate limiting for whitelisted IPs
    if (this.config.skipIps.includes(clientIp)) {
      return {
        allowed: true,
        remaining: this.config.maxRequests,
        resetTime: Date.now() + this.config.windowMs,
      };
    }

    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    // Get or create log for this client
    let log = this.logs.get(clientIp);
    if (!log) {
      log = { timestamps: [] };
      this.logs.set(clientIp, log);
    }

    // Remove timestamps outside the current window
    log.timestamps = log.timestamps.filter((ts) => ts > windowStart);

    // Calculate remaining requests
    const currentCount = log.timestamps.length;
    const remaining = Math.max(0, this.config.maxRequests - currentCount - 1);

    // Check if limit exceeded
    if (currentCount >= this.config.maxRequests) {
      const oldestTimestamp = log.timestamps[0] ?? now;
      const resetTime = oldestTimestamp + this.config.windowMs;
      const retryAfter = Math.ceil((resetTime - now) / 1000);

      return {
        allowed: false,
        remaining: 0,
        resetTime,
        retryAfter,
      };
    }

    // Allow request and record timestamp
    log.timestamps.push(now);

    return {
      allowed: true,
      remaining,
      resetTime: now + this.config.windowMs,
    };
  }

  /**
   * Clear rate limit logs for a specific client (for testing).
   */
  reset(clientIp?: string): void {
    if (clientIp) {
      this.logs.delete(clientIp);
    } else {
      this.logs.clear();
    }
  }

  /**
   * Clean up old logs to prevent memory leaks.
   * Should be called periodically in production.
   */
  cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    for (const [clientIp, log] of this.logs.entries()) {
      log.timestamps = log.timestamps.filter((ts) => ts > windowStart);
      if (log.timestamps.length === 0) {
        this.logs.delete(clientIp);
      }
    }
  }

  /**
   * Get current statistics for monitoring.
   */
  getStats(): { totalClients: number; totalRequests: number } {
    let totalRequests = 0;
    for (const log of this.logs.values()) {
      totalRequests += log.timestamps.length;
    }

    return {
      totalClients: this.logs.size,
      totalRequests,
    };
  }
}

/**
 * Get client IP from request headers (handles proxies).
 */
export function getClientIp(headers: Headers): string {
  // Check common proxy headers
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    // Take first IP if multiple proxies
    return forwardedFor.split(',')[0]?.trim() ?? 'unknown';
  }

  const realIp = headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }

  // Fallback to localhost (should never reach here with proper proxy config)
  return '127.0.0.1';
}

/**
 * Default rate limiter instance for general API endpoints.
 * Allows 300 requests per minute per client (5 per second sustained).
 * This is generous for legitimate use while preventing abuse.
 */
export const defaultRateLimiter = new RateLimiter({
  maxRequests: 300,
  windowMs: 60 * 1000, // 1 minute
});

/**
 * Strict rate limiter for admin endpoints.
 * Allows 20 requests per minute per client.
 */
export const adminRateLimiter = new RateLimiter({
  maxRequests: 20,
  windowMs: 60 * 1000, // 1 minute
});

/**
 * Cleanup old rate limit logs every 5 minutes to prevent memory leaks.
 */
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    defaultRateLimiter.cleanup();
    adminRateLimiter.cleanup();
  }, 5 * 60 * 1000);
}
