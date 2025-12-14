import { describe, expect, it } from "bun:test";
import { defaultK6Mapping, stepToK6Request, type K6ActionMapping } from "../src/action-map.js";
import {
  type ClickStep,
  type FavoriteToggleStep,
  type JourneySpec,
  type NavigateStep,
  type SelectTrackStep,
  type StartPlaybackStep,
  type TypeStep,
  type WaitForTextStep
} from "../src/types.js";

describe("action-map", () => {
  const mockSpec: JourneySpec = {
    id: "test-journey",
    steps: [],
    data: {
      trackRefs: {
        track1: { sidPath: "/MUSICIANS/H/Hubbard_Rob/Commando.sid" },
        track2: { sidPath: "/MUSICIANS/G/Galway_Martin/Comic_Bakery.sid" }
      }
    }
  };

  describe("stepToK6Request", () => {
    it("converts navigate step to page GET request", () => {
      const step: NavigateStep = { action: "navigate", target: "/" };
      const result = stepToK6Request(step, mockSpec);
      expect(result).toContain("http.get");
      expect(result).toContain('baseUrl + "/"');
    });

    it("converts navigate step with custom mapping", () => {
      const step: NavigateStep = { action: "navigate", target: "/browse" };
      const customMapping: K6ActionMapping = {
        searchEndpoint: "/search",
        playEndpoint: "/play",
        favoritesEndpoint: "/fav"
      };
      const result = stepToK6Request(step, mockSpec, customMapping);
      expect(result).toContain("/browse");
    });

    it("converts click step to UI-only comment", () => {
      const step: ClickStep = { action: "click", selector: "#button" };
      const result = stepToK6Request(step, mockSpec);
      expect(result).toBe("// UI-only step; no protocol call");
    });

    it("converts waitForText step to UI-only comment", () => {
      const step: WaitForTextStep = { action: "waitForText", text: "Loading..." };
      const result = stepToK6Request(step, mockSpec);
      expect(result).toBe("// UI-only step; no protocol call");
    });

    it("converts type step to search request", () => {
      const step: TypeStep = { action: "type", selector: "#search", value: "test query" };
      const result = stepToK6Request(step, mockSpec);
      expect(result).toContain("http.get");
      expect(result).toContain("/api/search");
      expect(result).toContain("test%20query");
    });

    it("handles special characters in type step value", () => {
      const step: TypeStep = { action: "type", selector: "#search", value: "a&b=c d/e" };
      const result = stepToK6Request(step, mockSpec);
      expect(result).toContain("a%26b%3Dc%20d%2Fe");
    });

    it("converts selectTrack step with trackRef lookup", () => {
      const step: SelectTrackStep = { action: "selectTrack", trackRef: "track1" };
      const result = stepToK6Request(step, mockSpec);
      expect(result).toContain("http.post");
      expect(result).toContain("/api/play");
      expect(result).toContain("/MUSICIANS/H/Hubbard_Rob/Commando.sid");
      expect(result).toContain("streamUrl");
    });

    it("converts selectTrack step without trackRef lookup", () => {
      const step: SelectTrackStep = { action: "selectTrack", trackRef: "unknownTrack" };
      const result = stepToK6Request(step, mockSpec);
      expect(result).toContain("http.post");
      expect(result).toContain("unknownTrack");
    });

    it("converts selectTrack step with empty data", () => {
      const emptySpec: JourneySpec = { id: "empty", steps: [] };
      const step: SelectTrackStep = { action: "selectTrack", trackRef: "someTrack" };
      const result = stepToK6Request(step, emptySpec);
      expect(result).toContain("someTrack");
    });

    it("converts startPlayback step to stream request", () => {
      const step: StartPlaybackStep = { action: "startPlayback" };
      const result = stepToK6Request(step, mockSpec);
      expect(result).toContain("http.get");
      expect(result).toContain("if (streamUrl)");
      expect(result).toContain("/api/health");
      expect(result).toContain("playback start");
    });

    it("converts favoriteToggle step with add action", () => {
      const step: FavoriteToggleStep = {
        action: "favoriteToggle",
        trackRef: "track1",
        toggle: "add"
      };
      const result = stepToK6Request(step, mockSpec);
      expect(result).toContain("http.post");
      expect(result).toContain("/api/favorites");
      expect(result).toContain("/MUSICIANS/H/Hubbard_Rob/Commando.sid");
    });

    it("converts favoriteToggle step with remove action", () => {
      const step: FavoriteToggleStep = {
        action: "favoriteToggle",
        trackRef: "track2",
        toggle: "remove"
      };
      const result = stepToK6Request(step, mockSpec);
      expect(result).toContain("http.del");
      expect(result).toContain("/api/favorites");
      expect(result).toContain("/MUSICIANS/G/Galway_Martin/Comic_Bakery.sid");
    });

    it("returns unsupported comment for unknown action", () => {
      const step = { action: "unknownAction" } as any;
      const result = stepToK6Request(step, mockSpec);
      expect(result).toBe("// Unsupported action");
    });
  });

  describe("defaultK6Mapping", () => {
    it("provides expected default endpoints", () => {
      expect(defaultK6Mapping.searchEndpoint).toBe("/api/search");
      expect(defaultK6Mapping.playEndpoint).toBe("/api/play");
      expect(defaultK6Mapping.favoritesEndpoint).toBe("/api/favorites");
    });
  });
});
