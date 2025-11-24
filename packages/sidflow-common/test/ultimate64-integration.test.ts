import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { Ultimate64Client } from "../src/ultimate64-client";
import { Ultimate64AudioCapture, SAMPLES_PER_PACKET, AUDIO_PACKET_SIZE } from "../src/ultimate64-capture";
import { createServer, type Server } from "node:http";
import dgram from "node:dgram";

describe("Ultimate 64 Integration (Mock Server)", () => {
  let httpServer: Server;
  let udpServer: dgram.Socket;
  let serverPort: number;
  let udpPort: number;
  let client: Ultimate64Client;

  beforeAll(async () => {
    // Start mock HTTP server for REST API
    httpServer = createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");

      // Handle version endpoint
      if (req.url === "/v1/version" && req.method === "GET") {
        res.writeHead(200);
        res.end(JSON.stringify({ version: "0.1", errors: [] }));
        return;
      }

      // Handle info endpoint
      if (req.url === "/v1/info" && req.method === "GET") {
        res.writeHead(200);
        res.end(
          JSON.stringify({
            product: "Ultimate 64",
            firmware_version: "3.12",
            fpga_version: "11F",
            hostname: "test-ultimate64",
            errors: [],
          })
        );
        return;
      }

      // Handle sidplay endpoint
      if (req.url?.startsWith("/v1/runners:sidplay") && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, errors: [] }));
        });
        return;
      }

      // Handle stream start endpoint
      if (req.url?.includes("/v1/streams/audio:start") && req.method === "PUT") {
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, errors: [] }));
        return;
      }

      // Handle stream stop endpoint
      if (req.url?.includes("/v1/streams/audio:stop") && req.method === "PUT") {
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, errors: [] }));
        return;
      }

      // Handle config categories endpoint
      if (req.url === "/v1/configs" && req.method === "GET") {
        res.writeHead(200);
        res.end(JSON.stringify({ categories: ["SID", "Audio", "Video"], errors: [] }));
        return;
      }

      // Handle specific config endpoint
      if (req.url?.startsWith("/v1/configs/") && !req.url.includes(":") && req.method === "GET") {
        const match = req.url.match(/\/v1\/configs\/([^?]+)/);
        if (match) {
          const category = decodeURIComponent(match[1]);
          res.writeHead(200);
          res.end(JSON.stringify({ category, items: [{ name: "item1", value: "value1" }], errors: [] }));
          return;
        }
      }

      // Handle config set endpoint
      if (req.url?.includes("/v1/configs/") && req.method === "PUT") {
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, errors: [] }));
        return;
      }

      // Handle machine reset endpoint
      if (req.url?.includes("/v1/machine:reset") && req.method === "PUT") {
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, errors: [] }));
        return;
      }

      // Default 404
      res.writeHead(404);
      res.end(JSON.stringify({ errors: ["Not found"] }));
    });

    // Start HTTP server on random port
    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", () => {
        const addr = httpServer.address();
        serverPort = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });

    // Start mock UDP server for audio streaming
    udpServer = dgram.createSocket("udp4");
    await new Promise<void>((resolve) => {
      udpServer.bind(0, "127.0.0.1", () => {
        const addr = udpServer.address();
        udpPort = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });

    // Create client
    client = new Ultimate64Client({
      host: `127.0.0.1:${serverPort}`,
      https: false,
    });
  });

  afterAll(async () => {
    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    }
    if (udpServer) {
      udpServer.close();
    }
  });

  test("REST API: Get version", async () => {
    const response = await client.getVersion();
    expect(response.errors).toEqual([]);
  });

  test("REST API: Get device info", async () => {
    const response = await client.getInfo();
    expect(response.errors).toEqual([]);
  });

  test("REST API: Send SID file", async () => {
    // Create a minimal fake SID file (just header)
    const sidBuffer = new Uint8Array(124);
    // Set magic "PSID" header
    sidBuffer[0] = 0x50; // P
    sidBuffer[1] = 0x53; // S
    sidBuffer[2] = 0x49; // I
    sidBuffer[3] = 0x44; // D

    const response = await client.sidplay({
      sidBuffer,
      songNumber: 1,
    });
    expect(response.errors).toEqual([]);
  });

  test("REST API: Start audio stream", async () => {
    const response = await client.startStream({
      stream: "audio",
      ip: "127.0.0.1",
      port: udpPort,
    });
    expect(response.errors).toEqual([]);
  });

  test("REST API: Stop audio stream", async () => {
    const response = await client.stopStream("audio");
    expect(response.errors).toEqual([]);
  });

  test("REST API: Set SID chip configuration", async () => {
    await client.setSidChip("6581");
    await client.setSidChip("8580r5");
    // If we get here without throwing, the test passed
    expect(true).toBe(true);
  });

  test("REST API: Get configuration categories", async () => {
    const response = await client.getConfigCategories();
    expect(response.errors).toEqual([]);
  });

  test("REST API: Get specific configuration", async () => {
    const response = await client.getConfig("SID");
    expect(response.errors).toEqual([]);
  });

  test("REST API: Reset machine", async () => {
    const response = await client.reset();
    expect(response.errors).toEqual([]);
  });

  test("UDP Audio Capture: Receive and process packets", async () => {
    // Use a different port for each test to avoid EADDRINUSE
    const capturePort = udpPort + 100;

    const capture = new Ultimate64AudioCapture({
      port: capturePort,
      maxLossRate: 0.1,
      targetDurationMs: 500, // Capture for 500ms
    });

    // Start capture
    await capture.start(capturePort);

    // Simulate sending audio packets from Ultimate 64
    const packetsToSend = 50; // About 200ms of audio at PAL rate
    const sendPackets = async () => {
      for (let seq = 0; seq < packetsToSend; seq++) {
        const packet = Buffer.alloc(AUDIO_PACKET_SIZE);

        // Write sequence number (16-bit LE)
        packet.writeUInt16LE(seq, 0);

        // Write sample data (192 stereo samples = 768 bytes)
        // Generate a simple sine wave for testing
        for (let i = 0; i < SAMPLES_PER_PACKET * 2; i++) {
          const sample = Math.sin((i / 100) * Math.PI * 2) * 16384;
          packet.writeInt16LE(Math.floor(sample), 2 + i * 2);
        }

        // Send packet
        udpServer.send(packet, capturePort, "127.0.0.1");

        // Small delay between packets to simulate real timing
        await new Promise((resolve) => setTimeout(resolve, 4)); // ~4ms per packet at PAL rate
      }
    };

    // Send packets in background
    sendPackets();

    // Wait for capture to complete
    await new Promise<void>((resolve) => {
      capture.once("stopped", () => {
        resolve();
      });

      // Safety timeout
      setTimeout(() => {
        if (capture.getStatistics().packetsReceived === 0) {
          capture.stop();
        }
        resolve();
      }, 1000);
    });

    // Get statistics
    const stats = capture.getStatistics();

    // Verify we received packets
    expect(stats.packetsReceived).toBeGreaterThan(0);
    expect(stats.lossRate).toBeLessThan(0.1); // Less than 10% loss
    expect(stats.durationMs).toBeGreaterThan(0);
  });

  test("UDP Audio Capture: Handle packet reordering", async () => {
    const capturePort = udpPort + 200;

    const capture = new Ultimate64AudioCapture({
      port: capturePort,
      maxLossRate: 0.1,
      bufferTimeMs: 200,
      targetDurationMs: 300,
    });

    await capture.start(capturePort);

    // Send packets out of order
    const sendOutOfOrderPackets = async () => {
      const packets = [0, 2, 1, 4, 3, 5]; // Deliberately out of order

      for (const seq of packets) {
        const packet = Buffer.alloc(AUDIO_PACKET_SIZE);
        packet.writeUInt16LE(seq, 0);

        // Fill with sample data
        for (let i = 0; i < SAMPLES_PER_PACKET * 2; i++) {
          packet.writeInt16LE(100 * seq + i, 2 + i * 2);
        }

        udpServer.send(packet, capturePort, "127.0.0.1");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };

    sendOutOfOrderPackets();

    await new Promise<void>((resolve) => {
      capture.once("stopped", () => resolve());
      setTimeout(() => resolve(), 500);
    });

    const stats = capture.getStatistics();
    expect(stats.packetsReordered).toBeGreaterThan(0);
  });

  test("UDP Audio Capture: Handle sequence number wraparound", async () => {
    const capturePort = udpPort + 300;

    const capture = new Ultimate64AudioCapture({
      port: capturePort,
      maxLossRate: 0.1,
      targetDurationMs: 300,
    });

    await capture.start(capturePort);

    // Send packets near wraparound boundary
    const sendWraparoundPackets = async () => {
      const sequences = [65534, 65535, 0, 1, 2]; // Wraparound at 65535->0

      for (const seq of sequences) {
        const packet = Buffer.alloc(AUDIO_PACKET_SIZE);
        packet.writeUInt16LE(seq, 0);

        for (let i = 0; i < SAMPLES_PER_PACKET * 2; i++) {
          // Use a sample value that fits in int16 range
          packet.writeInt16LE((seq % 100) * 100, 2 + i * 2);
        }

        udpServer.send(packet, capturePort, "127.0.0.1");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };

    sendWraparoundPackets();

    await new Promise<void>((resolve) => {
      capture.once("stopped", () => resolve());
      setTimeout(() => resolve(), 500);
    });

    const stats = capture.getStatistics();
    expect(stats.packetsReceived).toBe(5);
    expect(stats.packetsLost).toBe(0);
  });

  test("UDP Audio Capture: exposes buffer configuration", () => {
    const capture = new Ultimate64AudioCapture({
      port: udpPort + 400,
      bufferTimeMs: 250,
    });

    expect(capture.getBufferTimeMs()).toBe(250);
  });
});
