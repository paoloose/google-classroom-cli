// cligentic block: xdg-paths
//
// XDG Base Directory Spec resolver with macOS and Windows fallbacks.
// Gives your CLI a canonical directory layout instead of inventing
// ~/.myapp/ from scratch every time.
//
// Design rules:
//   1. Respect XDG env vars on Linux (XDG_CONFIG_HOME, XDG_STATE_HOME, etc).
//   2. Fall back to platform conventions: ~/Library on macOS, %APPDATA% on Windows.
//   3. Provide an APP_HOME env var override for testing.
//   4. Create directories lazily (only when ensureHome is called).
//   5. Pure functions, no side effects except ensureHome.
//
// Usage:
//   import { getAppPaths, ensureHome } from "./foundation/xdg-paths";
//
//   const paths = getAppPaths("myapp");
//   // paths.config   = ~/.config/myapp             (Linux/macOS)
//   // paths.profiles = ~/.config/myapp/profiles    (Linux/macOS)
//   // paths.sessions = ~/.config/myapp/sessions    (Linux/macOS)
//   // paths.home     = ~/.config/myapp             (Linux/macOS)
//
//   ensureHome(paths);  // creates all directories

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { platform } from "node:os";

export type AppPaths = {
  /** Primary config directory. TOML/JSON config files live here. */
  config: string;
  /** State directory. Sessions, pending approvals, killswitch file. */
  state: string;
  /** Cache directory. Temporary data safe to delete. */
  cache: string;
  /** Alias for config. The "home" of your CLI's persistent data. */
  home: string;
  /** Audit logs directory. Append-only JSONL files. */
  audit: string;
  /** Sessions directory. Auth tokens, refresh tokens. */
  sessions: string;
  /** Temporary directory for atomic writes. */
  tmp: string;
  /** Profiles directory. Contains user identity profiles. */
  profiles: string;
};

/**
 * Resolves the canonical directory paths for your CLI app.
 *
 * All persistent configuration, profiles, and state are consolidated under
 * ~/.config/<appName> (or %APPDATA%\<appName> on Windows).
 *
 * The APP_HOME env var (e.g., CLASSROOM_CLI_HOME) overrides everything, useful for
 * testing and CI where you don't want to pollute the real home directory.
 */
export function getAppPaths(appName: string): AppPaths {
  const envKey = `${appName.toUpperCase().replace(/-/g, "_")}_HOME`;
  const override = process.env[envKey];

  if (override) {
    return buildPaths(override);
  }

  const os = platform();
  const home = homedir();

  if (os === "win32") {
    const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
    const configDir = join(appData, appName);
    return buildPaths(configDir);
  }

  // Linux / macOS / Unix: Consolidate under XDG_CONFIG_HOME or ~/.config/<appName>
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(home, ".config");
  const configDir = join(xdgConfig, appName);
  return buildPaths(configDir);
}

/**
 * Creates all directories in the AppPaths tree. Idempotent.
 * Permissions: 0o700 for sensitive dirs (sessions, profiles), 0o755 for config.
 */
export function ensureHome(paths: AppPaths): void {
  mkdirSync(paths.config, { recursive: true, mode: 0o755 });
  mkdirSync(paths.profiles, { recursive: true, mode: 0o700 });
  mkdirSync(paths.sessions, { recursive: true, mode: 0o700 });
}

function buildPaths(root: string): AppPaths {
  return {
    config: root,
    state: root,
    cache: join(root, "cache"),
    home: root,
    audit: join(root, "audit"),
    sessions: join(root, "sessions"),
    tmp: join(root, "tmp"),
    profiles: join(root, "profiles"),
  };
}
