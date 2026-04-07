import {
  formatHelp,
  parseArgs,
  type ArgDef,
} from "@sidflow/common";
import type { StationCliOptions } from "./types.js";

const ARG_DEFS: ArgDef[] = [
  {
    name: "--config",
    type: "string",
    description: "Load an alternate .sidflow.json",
  },
  {
    name: "--db",
    type: "string",
    description: "Deprecated alias for --local-db",
  },
  {
    name: "--local-db",
    type: "string",
    description: "Path to a specific local similarity export bundle (.sqlite, .sidcorr, or optional .gz variant)",
  },
  {
    name: "--similarity-format",
    type: "string",
    description: "Similarity export format: auto, sqlite, lite, tiny",
    defaultValue: "auto",
  },
  {
    name: "--force-local-db",
    type: "boolean",
    description: "Use the latest local similarity export under data/exports for the selected format",
  },
  {
    name: "--reset-selections",
    type: "boolean",
    description: "Discard any persisted station ratings and force fresh seed capture",
  },
  {
    name: "--hvsc",
    type: "string",
    description: "HVSC or SID collection root used to locate playable files",
  },
  {
    name: "--features-jsonl",
    type: "string",
    description: "Optional companion features JSONL path for provenance display",
  },
  {
    name: "--playback",
    type: "string",
    description: "Playback mode: local, c64u, none",
  },
  {
    name: "--sidplay-path",
    type: "string",
    description: "Override sidplayfp executable path for local playback",
  },
  {
    name: "--c64u-host",
    type: "string",
    description: "Override Ultimate64 host for remote playback",
  },
  {
    name: "--c64u-password",
    type: "string",
    description: "Override the Ultimate64 Network Password (sent as X-Password)",
  },
  {
    name: "--c64u-https",
    type: "boolean",
    description: "Use HTTPS for Ultimate64 playback",
  },
  {
    name: "--adventure",
    type: "integer",
    description: "Exploration factor from 1-5",
    defaultValue: 3,
    constraints: { min: 1, max: 5 },
  },
  {
    name: "--sample-size",
    type: "integer",
    description: "Minimum number of songs to rate before station generation (minimum effective target: 5)",
    defaultValue: 5,
    constraints: { min: 1 },
  },
  {
    name: "--station-size",
    type: "integer",
    description: "Number of recommendations to keep in the station queue (minimum effective queue: 100 songs)",
    defaultValue: 100,
    constraints: { min: 1 },
  },
  {
    name: "--min-duration",
    type: "integer",
    description: "Minimum allowed song duration in seconds for seeds and station tracks",
    defaultValue: 15,
    constraints: { min: 1 },
  },
];

export const HELP_TEXT = formatHelp(
  "sidflow-play station [options]",
  `Interactive SID CLI Station proving the exported similarity bundle is self-contained.
By default the station uses the latest cached sidflow-data release bundle and checks GitHub for a newer bundle at most once per week.
Use --force-local-db for the latest local export or --local-db to point at a specific local bundle.
Persisted station ratings are reused automatically for the same dataset unless --reset-selections is supplied.
The optional features JSONL is only shown as companion provenance for local data.

Workflow:
  1. Pull random tracks directly from the export DB.
  2. Keep rating until at least 5 songs are actually rated.
  3. Build a station from the export vectors.
  4. Navigate with arrows, pause playback, rebuild recommendations on demand, and manage saved playlists without losing the current live song.
  5. Ignore tracks shorter than --min-duration.

Commands:
  Rating phase: 0-5 rate, l like(5), d dislike(0), s skip, b back, r refresh, q quit
  Station phase: * star filter, / text filter, Esc clear, left/right play prev/next, up/down/pgup/pgdn browse, enter play selected, space pause/resume, h reshuffle current playlist, g rebuild queue, w save playlist, o open playlist, s skip, l like(5), d dislike(0), r refresh, 0-5 rate, q quit`,
  ARG_DEFS,
  [
    "sidflow-play station",
    "sidflow-play station --playback none --sample-size 5 --station-size 100 --min-duration 20",
    "sidflow-play station --local-db data/exports/sidcorr-hvsc-full-sidcorr-lite-1.sidcorr --similarity-format lite",
    "sidflow-play station --c64u-host 192.168.1.13 --adventure 5",
  ],
);

export function parseStationArgs(argv: string[]) {
  return parseArgs<StationCliOptions>(argv, ARG_DEFS);
}
