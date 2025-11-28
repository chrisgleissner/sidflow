"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ChangeEvent,
} from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  getPreferences,
  updatePreferences,
  listHvscFolders,
  type FolderListing,
  type PreferencesPayload,
} from "@/lib/api-client";
import { formatApiError } from "@/lib/format-error";
import { FolderOpen } from "lucide-react";
import type { RenderTechnology } from "@sidflow/common";
import { usePreferences } from "@/context/preferences-context";
import { useFeedbackRuntimeState } from "@/lib/feedback/use-feedback-runtime";
import { triggerFeedbackTraining } from "@/lib/feedback/runtime";

interface AdminPrefsTabProps {
  onStatusChange: (status: string, isError?: boolean) => void;
}

const COLOR_SCHEMES = [
  {
    value: "c64-light",
    label: "C64 Light Blue",
    description: "Authentic C64 light blue background",
  },
  {
    value: "c64-dark",
    label: "C64 Dark Mode",
    description: "Black background with C64 colors",
  },
  {
    value: "classic",
    label: "Classic Purple",
    description: "Original purple theme",
  },
  {
    value: "system",
    label: "System Default",
    description: "Follow system preferences",
  },
];

const FONT_SCHEMES = [
  {
    value: "c64",
    label: "C64 Font",
    description: "Press Start 2P (C64-style)",
  },
  { value: "mono", label: "Monospace", description: "Courier New" },
  { value: "sans", label: "Sans Serif", description: "Arial / Helvetica" },
];

type SidplayMode = "balanced" | "fast" | "custom";

const RENDER_ENGINE_CHOICES: Array<{
  value: RenderTechnology;
  label: string;
  description: string;
}> = [
  {
    value: "wasm",
    label: "libsidplayfp-wasm (default)",
    description: "Portable, no external dependencies",
  },
  {
    value: "sidplayfp-cli",
    label: "sidplayfp CLI",
    description: "Requires sidplayfp installed on server",
  },
  {
    value: "ultimate64",
    label: "Ultimate 64",
    description: "Needs hardware and connectivity configured",
  },
];

export function AdminPrefsTab({ onStatusChange }: AdminPrefsTabProps) {
  const { preferences: browserPreferences, updatePreferences: updateBrowserPrefs } = usePreferences();
  const feedbackRuntime = useFeedbackRuntimeState();
  const [colorScheme, setColorScheme] = useState("system");
  const [fontScheme, setFontScheme] = useState("mono");
  const [prefsInfo, setPrefsInfo] = useState<PreferencesPayload | null>(null);
  const [renderEngine, setRenderEngine] = useState<RenderTechnology>("wasm");
  const [preferredEngines, setPreferredEngines] = useState<RenderTechnology[]>([]);
  const [pendingPreferredEngine, setPendingPreferredEngine] = useState<RenderTechnology | "">("");
  const [isSavingPreferredEngines, setIsSavingPreferredEngines] = useState(false);
  const [folderListing, setFolderListing] = useState<FolderListing | null>(
    null,
  );
  const [customPath, setCustomPath] = useState("");
  const [kernalPath, setKernalPath] = useState("");
  const [basicPath, setBasicPath] = useState("");
  const [chargenPath, setChargenPath] = useState("");
  const [audioFormats, setAudioFormats] = useState<string[]>(["wav"]);
  const [sidplayMode, setSidplayMode] = useState<SidplayMode>("balanced");
  const [sidplayCustomFlags, setSidplayCustomFlags] = useState("");
  const [isSavingSidplayFlags, setIsSavingSidplayFlags] = useState(false);
  const [isSavingCollection, setIsSavingCollection] = useState(false);
  const [isSavingRom, setIsSavingRom] = useState(false);
  const [isLoadingFolders, setIsLoadingFolders] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const kernalFileInputRef = useRef<HTMLInputElement | null>(null);
  const basicFileInputRef = useRef<HTMLInputElement | null>(null);
  const chargenFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const savedColor = localStorage.getItem("sidflow-color-scheme") || "system";
    const savedFont = localStorage.getItem("sidflow-font-scheme") || "mono";

    setColorScheme(savedColor);
    setFontScheme(savedFont);

    applyTheme(savedColor, savedFont);
  }, []);

  const applyTheme = (color: string, font: string) => {
    const html = document.documentElement;

    if (color === "system") {
      html.removeAttribute("data-theme");
    } else {
      html.setAttribute("data-theme", color);
    }

    html.classList.remove("font-c64", "font-mono", "font-sans");
    html.classList.add(`font-${font}`);
  };

  const handleColorChange = (value: string) => {
    setColorScheme(value);
    localStorage.setItem("sidflow-color-scheme", value);
    applyTheme(value, fontScheme);
    onStatusChange(
      `Color scheme changed to: ${COLOR_SCHEMES.find((s) => s.value === value)?.label}`,
    );
  };

  const handleFontChange = (value: string) => {
    setFontScheme(value);
    localStorage.setItem("sidflow-font-scheme", value);
    applyTheme(colorScheme, value);
    onStatusChange(
      `Font changed to: ${FONT_SCHEMES.find((s) => s.value === value)?.label}`,
    );
  };

  const syncSidplayState = useCallback((raw: string | null | undefined) => {
    const trimmed = raw?.trim() ?? "";
    if (trimmed.length === 0) {
      setSidplayMode("balanced");
      setSidplayCustomFlags("");
      return;
    }
    if (trimmed === "-rif --resid") {
      setSidplayMode("fast");
      setSidplayCustomFlags(trimmed);
      return;
    }
    setSidplayMode("custom");
    setSidplayCustomFlags(trimmed);
  }, []);

  const loadPreferences = useCallback(async () => {
    const response = await getPreferences();
    if (response.success) {
      setPrefsInfo(response.data);
      setRenderEngine(response.data.preferences.renderEngine ?? "wasm");
      setPreferredEngines(response.data.preferences.preferredEngines ?? []);
      setCustomPath(response.data.preferences.sidBasePath ?? "");
      setKernalPath(
        response.data.preferences.kernalRomPath ??
          response.data.sidplayfpConfig.kernalRomPath ??
          "",
      );
      setBasicPath(
        response.data.preferences.basicRomPath ??
          response.data.sidplayfpConfig.basicRomPath ??
          "",
      );
      setChargenPath(
        response.data.preferences.chargenRomPath ??
          response.data.sidplayfpConfig.chargenRomPath ??
          "",
      );
      syncSidplayState(response.data.preferences.sidplayfpCliFlags ?? null);
    } else {
      onStatusChange(
        `Failed to load preferences: ${formatApiError(response)}`,
        true,
      );
    }
  }, [onStatusChange, syncSidplayState]);

  const loadFolders = useCallback(
    async (relative: string) => {
      setIsLoadingFolders(true);
      setFolderError(null);
      try {
        const response = await listHvscFolders(relative);
        if (response.success) {
          setFolderListing(response.data);
        } else {
          const message = formatApiError(response);
          setFolderError(message);
          onStatusChange(`Unable to list folders: ${message}`, true);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setFolderError(message);
        onStatusChange(`Unable to list folders: ${message}`, true);
      } finally {
        setIsLoadingFolders(false);
      }
    },
    [onStatusChange],
  );

  const refreshPreferences = useCallback(async () => {
    await loadPreferences();
    await loadFolders("");
  }, [loadPreferences, loadFolders]);

  useEffect(() => {
    void refreshPreferences();
  }, [refreshPreferences]);

  const saveCollectionPath = useCallback(
    async (nextPath: string | null) => {
      setIsSavingCollection(true);
      try {
        const response = await updatePreferences({ sidBasePath: nextPath });
        if (response.success) {
          setPrefsInfo(response.data);
          setCustomPath(response.data.preferences.sidBasePath ?? "");
          onStatusChange(
            nextPath
              ? `Using SID subset at ${response.data.activeCollectionPath}`
              : "SID collection reset to HVSC default",
          );
        } else {
          onStatusChange(
            `Unable to save preference: ${formatApiError(response)}`,
            true,
          );
        }
      } catch (error) {
        onStatusChange(
          `Unable to save preference: ${error instanceof Error ? error.message : String(error)}`,
          true,
        );
      } finally {
        setIsSavingCollection(false);
      }
    },
    [onStatusChange],
  );

  const saveRomPath = useCallback(
    async (key: "kernal" | "basic" | "chargen", rawValue: string | null) => {
      setIsSavingRom(true);
      const trimmed = rawValue?.trim() ?? "";
      const normalized = trimmed.length > 0 ? trimmed : null;
      const payload: {
        kernalRomPath?: string | null;
        basicRomPath?: string | null;
        chargenRomPath?: string | null;
      } = {};
      if (key === "kernal") {
        payload.kernalRomPath = normalized;
      } else if (key === "basic") {
        payload.basicRomPath = normalized;
      } else {
        payload.chargenRomPath = normalized;
      }
      try {
        const response = await updatePreferences(payload);
        if (response.success) {
          setPrefsInfo(response.data);
          setKernalPath(
            response.data.preferences.kernalRomPath ??
              response.data.sidplayfpConfig.kernalRomPath ??
              "",
          );
          setBasicPath(
            response.data.preferences.basicRomPath ??
              response.data.sidplayfpConfig.basicRomPath ??
              "",
          );
          setChargenPath(
            response.data.preferences.chargenRomPath ??
              response.data.sidplayfpConfig.chargenRomPath ??
              "",
          );
          syncSidplayState(response.data.preferences.sidplayfpCliFlags ?? null);
          const label =
            key === "kernal" ? "KERNAL" : key === "basic" ? "BASIC" : "CHARGEN";
          const message = normalized
            ? `${label} ROM path set to ${normalized}`
            : `${label} ROM path cleared`;
          onStatusChange(message);
        } else {
          onStatusChange(
            `Unable to save ROM path: ${formatApiError(response)}`,
            true,
          );
        }
      } catch (error) {
        onStatusChange(
          `Unable to save ROM path: ${error instanceof Error ? error.message : String(error)}`,
          true,
        );
      } finally {
        setIsSavingRom(false);
      }
    },
    [onStatusChange, syncSidplayState],
  );

  const handleUseFolder = useCallback(async () => {
    if (!folderListing) {
      return;
    }
    await saveCollectionPath(folderListing.absolutePath);
  }, [folderListing, saveCollectionPath]);

  const handleFolderUp = useCallback(() => {
    if (!folderListing) {
      return;
    }
    const parts = folderListing.relativePath.split("/").filter(Boolean);
    if (parts.length === 0) {
      void loadFolders("");
      return;
    }
    parts.pop();
    void loadFolders(parts.join("/"));
  }, [folderListing, loadFolders]);

  const handleResetCollection = useCallback(async () => {
    await saveCollectionPath(null);
  }, [saveCollectionPath]);

  const handleCustomPathSave = useCallback(async () => {
    const value = customPath.trim();
    await saveCollectionPath(value.length > 0 ? value : null);
  }, [customPath, saveCollectionPath]);

  const handleBrowseFile = useCallback(
    (kind: "kernal" | "basic" | "chargen") => {
      const target =
        kind === "kernal"
          ? kernalFileInputRef.current
          : kind === "basic"
            ? basicFileInputRef.current
            : chargenFileInputRef.current;
      target?.click();
    },
    [],
  );

  const handleFileSelected = useCallback(
    (
      kind: "kernal" | "basic" | "chargen",
      event: ChangeEvent<HTMLInputElement>,
    ) => {
      const input = event.target;
      const [file] = input.files ?? [];
      const withPath = file as File & {
        path?: string;
        webkitRelativePath?: string;
      };

      const resolvedPath =
        (withPath &&
          (withPath.path || withPath.webkitRelativePath || withPath.name)) ||
        input.value ||
        "";

      if (kind === "kernal") {
        setKernalPath(resolvedPath);
      } else if (kind === "basic") {
        setBasicPath(resolvedPath);
      } else {
        setChargenPath(resolvedPath);
      }

      input.value = "";
    },
    [],
  );

  const addPreferredEngine = useCallback((engine: RenderTechnology) => {
    setPreferredEngines((current) =>
      current.includes(engine) ? current : [...current, engine],
    );
  }, []);

  const movePreferredEngine = useCallback(
    (engine: RenderTechnology, direction: "up" | "down") => {
      setPreferredEngines((current) => {
        const index = current.indexOf(engine);
        if (index === -1) {
          return current;
        }
        const targetIndex = direction === "up" ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= current.length) {
          return current;
        }
        const next = [...current];
        [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
        return next;
      });
    },
    [],
  );

  const removePreferredEngine = useCallback((engine: RenderTechnology) => {
    setPreferredEngines((current) => current.filter((entry) => entry !== engine));
  }, []);

  const handleSidplayModeChange = useCallback((value: SidplayMode) => {
    setSidplayMode(value);
    if (value === "balanced") {
      setSidplayCustomFlags("");
    } else if (value === "fast") {
      setSidplayCustomFlags("-rif --resid");
    }
  }, []);

  const handleResetSidplayFlags = useCallback(() => {
    setSidplayMode("balanced");
    setSidplayCustomFlags("");
  }, []);

  const handleSavePreferredEngines = useCallback(async () => {
    setIsSavingPreferredEngines(true);
    const payload = preferredEngines.length > 0 ? preferredEngines : null;
    try {
      const response = await updatePreferences({ preferredEngines: payload });
      if (response.success) {
        setPrefsInfo(response.data);
        setPreferredEngines(response.data.preferences.preferredEngines ?? []);
        const savedOrder = response.data.preferences.preferredEngines ?? [];
        onStatusChange(
          savedOrder.length
            ? `Preferred render engine order saved: ${savedOrder.join(" → ")}`
            : "Preferred render engine order reset to defaults",
        );
      } else {
        onStatusChange(
          `Unable to save preferred engines: ${formatApiError(response)}`,
          true,
        );
      }
    } catch (error) {
      onStatusChange(
        `Unable to save preferred engines: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    } finally {
      setIsSavingPreferredEngines(false);
    }
  }, [preferredEngines, onStatusChange]);

  const handleResetPreferredEngines = useCallback(async () => {
    setIsSavingPreferredEngines(true);
    try {
      const response = await updatePreferences({ preferredEngines: null });
      if (response.success) {
        setPrefsInfo(response.data);
        setPreferredEngines(response.data.preferences.preferredEngines ?? []);
        onStatusChange("Preferred render engine order reset to defaults");
      } else {
        onStatusChange(
          `Unable to reset preferred engines: ${formatApiError(response)}`,
          true,
        );
      }
    } catch (error) {
      onStatusChange(
        `Unable to reset preferred engines: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    } finally {
      setIsSavingPreferredEngines(false);
    }
  }, [onStatusChange]);

  const handleSaveSidplayFlags = useCallback(async () => {
    setIsSavingSidplayFlags(true);
    let flagsToSave: string | null;
    if (sidplayMode === "balanced") {
      flagsToSave = null;
    } else if (sidplayMode === "fast") {
      flagsToSave = "-rif --resid";
    } else {
      const trimmed = sidplayCustomFlags.trim();
      if (trimmed.length === 0) {
        onStatusChange("Custom sidplayfp CLI flags cannot be empty", true);
        setIsSavingSidplayFlags(false);
        return;
      }
      flagsToSave = trimmed;
    }

    try {
      const response = await updatePreferences({
        sidplayfpCliFlags: flagsToSave,
      });
      if (response.success) {
        setPrefsInfo(response.data);
        syncSidplayState(response.data.preferences.sidplayfpCliFlags ?? null);
        onStatusChange(
          flagsToSave
            ? `sidplayfp CLI flags updated to "${flagsToSave}"`
            : "sidplayfp CLI flags reset to default",
        );
      } else {
        onStatusChange(
          `Unable to save sidplayfp CLI flags: ${formatApiError(response)}`,
          true,
        );
      }
    } catch (error) {
      onStatusChange(
        `Unable to save sidplayfp CLI flags: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    } finally {
      setIsSavingSidplayFlags(false);
    }
  }, [sidplayMode, sidplayCustomFlags, onStatusChange, syncSidplayState]);

  const handleTrainingToggle = useCallback(
    async (enabled: boolean) => {
      await updateBrowserPrefs({
        training: {
          ...browserPreferences.training,
          enabled,
        },
      });
      onStatusChange(enabled ? 'Local training enabled' : 'Local training disabled');
    },
    [browserPreferences.training, onStatusChange, updateBrowserPrefs]
  );

  const handleTriggerTraining = useCallback(() => {
    if (!browserPreferences.training.enabled) {
      onStatusChange('Enable background training first', true);
      return;
    }
    triggerFeedbackTraining('manual-prefs');
    onStatusChange('Training run queued');
  }, [browserPreferences.training.enabled, onStatusChange]);

  const trainingStatusText = !feedbackRuntime.trainingEnabled
    ? 'Training disabled'
    : !feedbackRuntime.lastTraining
      ? 'Training enabled – no runs yet'
      : `Last run: ${new Date(feedbackRuntime.lastTraining.timestamp).toLocaleString()} · ${feedbackRuntime.lastTraining.samples} samples`;

  const availablePreferredEngineOptions = RENDER_ENGINE_CHOICES.filter(
    (option) => !preferredEngines.includes(option.value),
  );

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">
          Preferences
        </h2>
        <p className="text-sm text-muted-foreground">
          Manage playback defaults, collection paths, and ROM bundles.
        </p>
      </header>
      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="petscii-text text-accent">
            SID COLLECTION
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Limit playback, rating, training, and classification to a specific
            folder.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="space-y-1">
            <p className="font-semibold text-foreground">
              Active collection:{" "}
              <span className="font-mono text-xs">
                {prefsInfo?.activeCollectionPath ?? "…"}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              {prefsInfo?.preferenceSource === "custom"
                ? "Using a custom subset."
                : "Using the full HVSC mirror."}
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">
              Browse HVSC folders
            </p>
            {folderListing ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between text-[11px] font-mono text-muted-foreground">
                  <span className="truncate">{folderListing.absolutePath}</span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleFolderUp}
                      disabled={
                        folderListing.relativePath.length === 0 ||
                        isLoadingFolders
                      }
                    >
                      Up
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => loadFolders("")}
                      disabled={isLoadingFolders}
                    >
                      Root
                    </Button>
                  </div>
                </div>
                {folderError && (
                  <p className="text-xs text-destructive">{folderError}</p>
                )}
                <div className="rounded border border-border/60 bg-muted/30 p-2">
                  {folderListing.entries.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No subfolders.
                    </p>
                  ) : (
                    <div className="grid gap-1">
                      {folderListing.entries.map((entry) => (
                        <button
                          key={entry.path}
                          type="button"
                          onClick={() => loadFolders(entry.path)}
                          className="flex items-center justify-between rounded px-2 py-1 text-xs hover:bg-background/70 text-foreground"
                          disabled={isLoadingFolders}
                        >
                          <span className="font-mono">{entry.name}</span>
                          {entry.hasChildren && (
                            <span className="text-muted-foreground">›</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <Button
                  onClick={handleUseFolder}
                  disabled={isSavingCollection || !folderListing}
                  className="w-full"
                >
                  Use This Folder
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Loading folder tree…
              </p>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">
              Custom path
            </p>
            <div className="flex flex-col gap-2 md:flex-row">
              <Input
                value={customPath}
                onChange={(event) => setCustomPath(event.target.value)}
                placeholder="Enter absolute path"
              />
              <Button
                variant="secondary"
                onClick={handleCustomPathSave}
                disabled={isSavingCollection}
              >
                Save
              </Button>
              <Button
                variant="ghost"
                onClick={handleResetCollection}
                disabled={isSavingCollection}
              >
                Reset
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              The path must exist on disk. Relative paths resolve against the
              repository root.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="petscii-text text-accent">RENDER ENGINE</CardTitle>
          <CardDescription className="text-muted-foreground">
            Choose the server-side engine used for renders in admin operations. Default is WASM.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm">
          <div className="grid gap-2">
            <p className="text-xs font-semibold text-muted-foreground">Engine</p>
            <Select
              value={renderEngine}
              onValueChange={(value) => setRenderEngine(value as RenderTechnology)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select engine" />
              </SelectTrigger>
              <SelectContent>
                {RENDER_ENGINE_CHOICES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <div className="flex flex-col">
                      <span className="font-semibold">{option.label}</span>
                      <span className="text-xs text-muted-foreground">{option.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={async () => {
                const response = await updatePreferences({ renderEngine });
                if (response.success) {
                  setPrefsInfo(response.data);
                  onStatusChange(`Render engine set to ${renderEngine}`);
                } else {
                  onStatusChange(`Unable to save render engine: ${formatApiError(response)}`, true);
                }
              }}
            >
              Save
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                const response = await updatePreferences({ renderEngine: null });
                if (response.success) {
                  setPrefsInfo(response.data);
                  setRenderEngine("wasm");
                  onStatusChange('Render engine reset to default (wasm)');
                } else {
                  onStatusChange(`Unable to reset render engine: ${formatApiError(response)}`, true);
                }
              }}
            >
              Reset
            </Button>
          </div>
          <div className="grid gap-3 border-t border-border/60 pt-4">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">
                Preferred order (auto mode)
              </p>
              <p className="text-[11px] text-muted-foreground">
                When Classify runs in auto mode, engines are tried in this order before falling back to WASM.
              </p>
            </div>
            <div className="space-y-2 rounded border border-border/60 bg-muted/30 p-2">
              {preferredEngines.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No overrides set. The system will use the order from <code>.sidflow.json</code> (default: WASM → sidplayfp-cli → ultimate64).
                </p>
              ) : (
                <ol className="space-y-2 text-sm text-foreground">
                  {preferredEngines.map((engine, index) => {
                    const details = RENDER_ENGINE_CHOICES.find(
                      (option) => option.value === engine,
                    );
                    return (
                      <li
                        key={engine}
                        className="flex items-center justify-between gap-3 rounded border border-border/40 bg-background/60 px-3 py-2"
                      >
                        <div>
                          <p className="font-semibold">
                            #{index + 1} — {details?.label ?? engine}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {details?.description ?? ""}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => movePreferredEngine(engine, "up")}
                            disabled={index === 0 || isSavingPreferredEngines}
                          >
                            Up
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => movePreferredEngine(engine, "down")}
                            disabled={
                              index === preferredEngines.length - 1 ||
                              isSavingPreferredEngines
                            }
                          >
                            Down
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removePreferredEngine(engine)}
                            disabled={isSavingPreferredEngines}
                          >
                            Remove
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
            <div className="flex flex-col gap-2 md:flex-row">
              <Select
                value={pendingPreferredEngine || undefined}
                onValueChange={(value) =>
                  setPendingPreferredEngine(value as RenderTechnology)
                }
                disabled={availablePreferredEngineOptions.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Add engine" />
                </SelectTrigger>
                <SelectContent>
                  {availablePreferredEngineOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <div className="flex flex-col">
                        <span className="font-semibold">{option.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                onClick={() => {
                  if (!pendingPreferredEngine) {
                    return;
                  }
                  addPreferredEngine(pendingPreferredEngine);
                  setPendingPreferredEngine("");
                }}
                disabled={
                  !pendingPreferredEngine || isSavingPreferredEngines
                }
              >
                Add to order
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={handleSavePreferredEngines}
                disabled={isSavingPreferredEngines}
              >
                Save order
              </Button>
              <Button
                variant="ghost"
                onClick={handleResetPreferredEngines}
                disabled={isSavingPreferredEngines}
              >
                Reset overrides
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Order is optional—WASM is always appended as the final fallback even if it is not listed above.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="petscii-text text-accent">AUDIO FORMATS</CardTitle>
          <CardDescription className="text-muted-foreground">
            Choose which audio formats to render during classification. WAV is always required.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm">
          <div className="grid gap-3">
            <p className="text-xs font-semibold text-muted-foreground">Enabled Formats</p>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={true}
                  disabled={true}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <div className="flex flex-col">
                  <span className="font-semibold">WAV (required)</span>
                  <span className="text-xs text-muted-foreground">
                    Uncompressed audio, used for feature extraction
                  </span>
                </div>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={audioFormats.includes("flac")}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setAudioFormats([...audioFormats, "flac"]);
                    } else {
                      setAudioFormats(audioFormats.filter((f) => f !== "flac"));
                    }
                  }}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <div className="flex flex-col">
                  <span className="font-semibold">FLAC</span>
                  <span className="text-xs text-muted-foreground">
                    Lossless compression, high quality archival
                  </span>
                </div>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={audioFormats.includes("m4a")}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setAudioFormats([...audioFormats, "m4a"]);
                    } else {
                      setAudioFormats(audioFormats.filter((f) => f !== "m4a"));
                    }
                  }}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <div className="flex flex-col">
                  <span className="font-semibold">M4A (AAC)</span>
                  <span className="text-xs text-muted-foreground">
                    Lossy compression, good quality, smaller files
                  </span>
                </div>
              </label>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={async () => {
                // Build the formats array ensuring WAV is always first
                const formats = ["wav", ...audioFormats.filter((f) => f !== "wav")];
                const response = await updatePreferences({ defaultFormats: formats });
                if (response.success) {
                  setPrefsInfo(response.data);
                  onStatusChange(`Audio formats updated: ${formats.join(", ")}`);
                } else {
                  onStatusChange(`Unable to save audio formats: ${formatApiError(response)}`, true);
                }
              }}
            >
              Save
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setAudioFormats(["wav"]);
                onStatusChange('Audio formats reset to default (WAV only)');
              }}
            >
              Reset
            </Button>
          </div>
          <div className="text-xs text-muted-foreground border-t border-border/60 pt-3">
            <p className="font-semibold mb-1">Note:</p>
            <p>
              Enabling FLAC/M4A increases classification time but provides additional formats for
              playback and archival. The WAV file is always rendered first and used for feature extraction.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="petscii-text text-accent">
            SIDPLAY CLI
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Configure sidplayfp flags for faster renders or maximum fidelity.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm">
          <div className="grid gap-2">
            <p className="text-xs font-semibold text-muted-foreground">Mode</p>
            <Select
              value={sidplayMode}
              onValueChange={(value) =>
                handleSidplayModeChange(value as SidplayMode)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="balanced">
                  <div className="flex flex-col">
                    <span className="font-semibold">Balanced (default)</span>
                    <span className="text-xs text-muted-foreground">
                      No extra flags; highest accuracy
                    </span>
                  </div>
                </SelectItem>
                <SelectItem value="fast">
                  <div className="flex flex-col">
                    <span className="font-semibold">Fast render</span>
                    <span className="text-xs text-muted-foreground">
                      Applies -rif --resid for lower latency
                    </span>
                  </div>
                </SelectItem>
                <SelectItem value="custom">
                  <div className="flex flex-col">
                    <span className="font-semibold">Custom</span>
                    <span className="text-xs text-muted-foreground">
                      Provide your own flag string
                    </span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {sidplayMode === "custom" && (
            <div className="grid gap-2">
              <p className="text-xs font-semibold text-muted-foreground">
                CLI flags
              </p>
              <Input
                value={sidplayCustomFlags}
                onChange={(event) => setSidplayCustomFlags(event.target.value)}
                placeholder="-rif --resid"
              />
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={handleSaveSidplayFlags}
              disabled={isSavingSidplayFlags}
            >
              Save
            </Button>
            <Button
              variant="ghost"
              onClick={handleResetSidplayFlags}
              disabled={isSavingSidplayFlags}
            >
              Reset
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            The fast preset applies -rif --resid; it speeds up sidplayfp but may
            introduce artifacts on certain tunes.
          </p>
        </CardContent>
      </Card>

      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="petscii-text text-accent">
            ROM BUNDLES
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Override the default ROM bundle used by libsidplayfp.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm">
          <fieldset className="grid gap-2">
            <legend className="text-xs font-semibold text-muted-foreground">
              KERNAL ROM
            </legend>
            <div className="flex flex-col gap-2 md:flex-row">
              <Input
                value={kernalPath}
                onChange={(event) => setKernalPath(event.target.value)}
              />
              <div className="flex gap-2">
                <Input
                  ref={kernalFileInputRef}
                  type="file"
                  accept=".rom,.bin"
                  onChange={(event) => handleFileSelected("kernal", event)}
                  className="hidden"
                />
                <Button
                  variant="outline"
                  onClick={() => handleBrowseFile("kernal")}
                >
                  <FolderOpen className="mr-2 h-4 w-4" /> Browse
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => saveRomPath("kernal", kernalPath)}
                  disabled={isSavingRom}
                >
                  Save
                </Button>
              </div>
            </div>
          </fieldset>

          <fieldset className="grid gap-2">
            <legend className="text-xs font-semibold text-muted-foreground">
              BASIC ROM
            </legend>
            <div className="flex flex-col gap-2 md:flex-row">
              <Input
                value={basicPath}
                onChange={(event) => setBasicPath(event.target.value)}
              />
              <div className="flex gap-2">
                <Input
                  ref={basicFileInputRef}
                  type="file"
                  accept=".rom,.bin"
                  onChange={(event) => handleFileSelected("basic", event)}
                  className="hidden"
                />
                <Button
                  variant="outline"
                  onClick={() => handleBrowseFile("basic")}
                >
                  <FolderOpen className="mr-2 h-4 w-4" /> Browse
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => saveRomPath("basic", basicPath)}
                  disabled={isSavingRom}
                >
                  Save
                </Button>
              </div>
            </div>
          </fieldset>

          <fieldset className="grid gap-2">
            <legend className="text-xs font-semibold text-muted-foreground">
              CHARGEN ROM
            </legend>
            <div className="flex flex-col gap-2 md:flex-row">
              <Input
                value={chargenPath}
                onChange={(event) => setChargenPath(event.target.value)}
              />
              <div className="flex gap-2">
                <Input
                  ref={chargenFileInputRef}
                  type="file"
                  accept=".rom,.bin"
                  onChange={(event) => handleFileSelected("chargen", event)}
                  className="hidden"
                />
                <Button
                  variant="outline"
                  onClick={() => handleBrowseFile("chargen")}
                >
                  <FolderOpen className="mr-2 h-4 w-4" /> Browse
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => saveRomPath("chargen", chargenPath)}
                  disabled={isSavingRom}
                >
                  Save
                </Button>
              </div>
            </div>
          </fieldset>
        </CardContent>
      </Card>

      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="petscii-text text-accent">
            LOCAL TRAINING
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Enable local model training based on your feedback.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm">
          <div className="space-y-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={browserPreferences.training.enabled}
                onChange={(event) => void handleTrainingToggle(event.target.checked)}
              />
              <span>Enable background training</span>
            </label>
            
            <div className="bg-muted/40 rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground">Training Status</p>
                  <p className="text-xs text-foreground">{trainingStatusText}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Base model: v{feedbackRuntime.baseModelVersion ?? 'unknown'} · 
                    Local model: v{feedbackRuntime.localModelVersion ?? 'none'}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleTriggerTraining}
                  disabled={!browserPreferences.training.enabled}
                >
                  Train Now
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="petscii-text text-accent">
            THEME & FONT
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Visual preferences stored locally for your browser.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="grid gap-2">
            <p className="text-xs font-semibold text-muted-foreground">Theme</p>
            <Select value={colorScheme} onValueChange={handleColorChange}>
              <SelectTrigger className="capitalize">
                <SelectValue placeholder="Select theme" />
              </SelectTrigger>
              <SelectContent>
                {COLOR_SCHEMES.map((scheme) => (
                  <SelectItem key={scheme.value} value={scheme.value}>
                    <div className="flex flex-col">
                      <span className="font-semibold">{scheme.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {scheme.description}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <p className="text-xs font-semibold text-muted-foreground">Font</p>
            <Select value={fontScheme} onValueChange={handleFontChange}>
              <SelectTrigger className="capitalize">
                <SelectValue placeholder="Select font" />
              </SelectTrigger>
              <SelectContent>
                {FONT_SCHEMES.map((scheme) => (
                  <SelectItem key={scheme.value} value={scheme.value}>
                    <div className="flex flex-col">
                      <span className="font-semibold">{scheme.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {scheme.description}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
