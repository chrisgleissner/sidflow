/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test";

import { fetchHvscManifest } from "../src/manifest.js";

const originalFetch = globalThis.fetch;

function setFetchStub(factory: () => Promise<Response> | Response): void {
  const stub = (async (..._args: Parameters<typeof fetch>) => factory()) as typeof fetch;
  Object.assign(stub, originalFetch);
  globalThis.fetch = stub;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchHvscManifest", () => {
  it("parses the manifest listing and sorts entries", async () => {
    const listing = [
      "<a href=\"HVSC_82-all-of-them.7z\">HVSC_82-all-of-them.7z</a>",
      "<a href=\"HVSC_83-all-of-them.7z\">HVSC_83-all-of-them.7z</a>",
      "<a href=\"HVSC_Update_83.7z\">HVSC_Update_83.7z</a>",
      "<a href=\"HVSC_Update_84.7z\">HVSC_Update_84.7z</a>",
      "<a href=\"HVSC_update_83.7z\">HVSC_update_83.7z</a>",
      "<a href=\"HVSC_Update_85.7z\">HVSC_Update_85.7z</a>"
    ].join("\n");

  setFetchStub(async () => new Response(listing, { status: 200 }));

    const manifest = await fetchHvscManifest("https://mirror.example/HVSC/");
    expect(manifest.base).toEqual({
      version: 83,
      filename: "HVSC_83-all-of-them.7z",
      url: "https://mirror.example/HVSC/HVSC_83-all-of-them.7z"
    });
    expect(manifest.deltas.map((delta) => delta.version)).toEqual([83, 84, 85]);
    expect(manifest.deltas.map((delta) => delta.filename)).toEqual([
      "HVSC_Update_83.7z",
      "HVSC_Update_84.7z",
      "HVSC_Update_85.7z"
    ]);
  });

  it("throws when the manifest does not include a base archive", async () => {
  setFetchStub(async () => new Response("<html>empty</html>", { status: 200 }));

    await expect(fetchHvscManifest("https://mirror.example/HVSC/")).rejects.toThrow(
      "Unable to locate HVSC base archive in remote manifest"
    );
  });

  it("throws when the remote request fails", async () => {
  setFetchStub(async () => new Response("", { status: 503, statusText: "Service Unavailable" }));

    await expect(fetchHvscManifest("https://mirror.example/HVSC/")).rejects.toThrow(
      "Failed to fetch HVSC manifest"
    );
  });
});
