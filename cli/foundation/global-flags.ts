// cligentic block: global-flags
//
// Standard global flags every agent-first CLI should expose.
// Returns a typed options object that other blocks (json-mode,
// killswitch, config) consume.
//
// Usage:
//   import { type GlobalFlags, parseGlobalFlags } from "./foundation/global-flags";
//
//   // After your argv parser extracts raw opts:
//   const flags = parseGlobalFlags(rawOpts);
//   emit(data, flags);  // json-mode reads flags.json
//   note("loading...", flags);  // respects flags.quiet

export type GlobalFlags = {
  /** Emit JSON output for agents. Implied when stdout is piped. */
  json: boolean;
  /** Validate without calling upstream. */
  dryRun: boolean;
  /** Config profile name. */
  profile: string | undefined;
  /** Never prompt, fail fast. For CI and agents. */
  noInput: boolean;
  /** Suppress non-essential output. */
  quiet: boolean;
  /** Verbose logging to stderr. */
  verbose: boolean;
  /** Inclusive start date for output filtering (ISO or partial). */
  from: string | undefined;
  /** Relative duration window for output filtering (e.g. "7d", "24h"). */
  last: string | undefined;
};

/**
 * Normalizes raw CLI options into a typed GlobalFlags object.
 * Handles common aliases and env var fallbacks.
 *
 * Pass the output of your argv parser (commander opts, citty args, etc).
 */
export function parseGlobalFlags(raw: Record<string, unknown> = {}): GlobalFlags {
  return {
    json: Boolean(raw.json ?? process.env.CLI_JSON === "1"),
    dryRun: Boolean(raw.dryRun ?? raw["dry-run"] ?? false),
    profile: (raw.profile as string) ?? process.env.CLI_PROFILE ?? undefined,
    noInput: Boolean(raw.noInput ?? raw["no-input"] ?? process.env.CI === "true"),
    quiet: Boolean(raw.quiet ?? raw.q ?? false),
    verbose: Boolean(raw.verbose ?? raw.v ?? false),
    from: (raw.from as string) ?? process.env.CLI_FROM ?? undefined,
    last: (raw.last as string) ?? process.env.CLI_LAST ?? undefined,
  };
}

/**
 * Returns the flag definitions as an array. Useful for registering
 * with commander, citty, or any argv parser.
 *
 * Example with commander:
 *   for (const f of getGlobalFlagDefs()) {
 *     program.option(f.flag, f.description);
 *   }
 */
export function getGlobalFlagDefs() {
  return [
    { flag: "--json", description: "Emit JSON output for agents" },
    { flag: "--dry-run", description: "Validate without calling upstream" },
    { flag: "--profile <name>", description: "Config profile to use" },
    { flag: "--no-input", description: "Never prompt, fail fast" },
    { flag: "-q, --quiet", description: "Suppress non-essential output" },
    { flag: "-v, --verbose", description: "Verbose logging to stderr" },
    { flag: "--from <date>", description: "Filter output to items on/after this date (ISO preferred; partial dates fill from current)" },
    { flag: "--last <duration>", description: "Filter output to items within this duration window from now (e.g. 7d, 24h, 1y2m)" },
  ] as const;
}
