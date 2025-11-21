export type JourneyAction =
  | "navigate"
  | "click"
  | "type"
  | "waitForText"
  | "selectTrack"
  | "startPlayback"
  | "favoriteToggle";

export interface JourneyStepBase {
  action: JourneyAction;
  description?: string;
}

export interface NavigateStep extends JourneyStepBase {
  action: "navigate";
  target: string;
}

export interface ClickStep extends JourneyStepBase {
  action: "click";
  selector: string;
}

export interface TypeStep extends JourneyStepBase {
  action: "type";
  selector: string;
  value: string;
}

export interface WaitForTextStep extends JourneyStepBase {
  action: "waitForText";
  text: string;
}

export interface SelectTrackStep extends JourneyStepBase {
  action: "selectTrack";
  trackRef: string;
}

export interface StartPlaybackStep extends JourneyStepBase {
  action: "startPlayback";
  expectStream?: boolean;
}

export interface FavoriteToggleStep extends JourneyStepBase {
  action: "favoriteToggle";
  trackRef: string;
  toggle: "add" | "remove";
}

export type JourneyStep =
  | NavigateStep
  | ClickStep
  | TypeStep
  | WaitForTextStep
  | SelectTrackStep
  | StartPlaybackStep
  | FavoriteToggleStep;

export interface TrackRef {
  sidPath: string;
  displayName?: string;
}

export interface JourneySpec {
  id: string;
  description?: string;
  pacingSeconds?: number;
  steps: JourneyStep[];
  data?: {
    trackRefs?: Record<string, TrackRef>;
  };
}

export type EnvironmentKind = "local" | "ci" | "remote";

export interface RunnerEnvironment {
  kind: EnvironmentKind;
  baseUrl?: string;
  authToken?: string;
  dataset?: string;
  enableRemote?: boolean;
  pacingSeconds?: number;
}

export type ExecutorKind = "playwright" | "k6";

export interface UserVariants {
  playwright: number[];
  k6: number[];
}

export interface GeneratedScript {
  executor: ExecutorKind;
  journeyId: string;
  users: number;
  scriptPath: string;
  resultDir: string;
  command: string[];
  env: Record<string, string | undefined>;
}

export interface RunnerArtifacts {
  timestamp: string;
  resultRoot: string;
  summaryPath: string;
  reportPath: string;
  scripts: GeneratedScript[];
}
