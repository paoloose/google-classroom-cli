// cligentic block: audit
//
// Structured developer & agent audit logging system.
// Records every command execution, arguments, flags, profile, duration,
// exit code, status, summary, and error details in JSONL format.
//
// Storage: ~/.config/classroom-cli/audit/audit.jsonl
// Permissions: 0o700 on audit dir, 0o600 on audit log files.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { getAppPaths, ensureHome } from "./xdg-paths.js";
import { ProfileManager } from "./profile.js";
import type { GlobalFlags } from "./global-flags.js";

export interface AuditRecord {
  id: string;
  timestamp: string;
  command: string;
  noun: string;
  verb?: string | undefined;
  profile: string;
  args: (string | number)[];
  flags: Record<string, unknown>;
  durationMs: number;
  status: "success" | "error";
  exitCode: number;
  resultSummary?: string | undefined;
  error?: {
    name?: string | undefined;
    code?: string | undefined;
    message: string;
    hint?: string | undefined;
    stack?: string | undefined;
  } | undefined;
  environment: {
    pid: number;
    platform: string;
    nodeVersion: string;
    isTTY: boolean;
    isAgent: boolean;
    ci: boolean;
  };
}

const SENSITIVE_KEYS = /secret|token|password|auth|cred|key/i;

export function sanitizeFlags(flags: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flags)) {
    if (k === "_") continue;
    if (SENSITIVE_KEYS.test(k)) {
      sanitized[k] = "[REDACTED]";
    } else {
      sanitized[k] = v;
    }
  }
  return sanitized;
}

export function sanitizeArgs(args: (string | number)[]): (string | number)[] {
  return args.map((arg, idx) => {
    const prev = args[idx - 1];
    if (typeof prev === "string" && /--client-secret|--secret|--password/i.test(prev)) {
      return "[REDACTED]";
    }
    return arg;
  });
}

function getAuditLogPath(): string {
  const paths = getAppPaths("classroom-cli");
  ensureHome(paths);
  if (!existsSync(paths.audit)) {
    mkdirSync(paths.audit, { recursive: true, mode: 0o700 });
  }
  return join(paths.audit, "audit.jsonl");
}

export function recordAuditLog(entry: AuditRecord): void {
  try {
    const filePath = getAuditLogPath();
    const line = JSON.stringify(entry) + "\n";
    appendFileSync(filePath, line, { encoding: "utf-8", mode: 0o600 });
  } catch {
    // Audit logging failure must never crash the primary CLI command
  }
}

export function formatResultSummary(data: any): string {
  if (data === null || data === undefined) return "Success";
  if (Array.isArray(data)) return `Returned ${data.length} item${data.length === 1 ? "" : "s"}`;
  if (typeof data === "object") {
    if (data.courses && Array.isArray(data.courses)) return `Returned ${data.courses.length} course${data.courses.length === 1 ? "" : "s"}`;
    if (data.courseWork && Array.isArray(data.courseWork)) return `Returned ${data.courseWork.length} coursework item${data.courseWork.length === 1 ? "" : "s"}`;
    if (data.materials && Array.isArray(data.materials)) return `Returned ${data.materials.length} material${data.materials.length === 1 ? "" : "s"}`;
    if (data.topics && Array.isArray(data.topics)) return `Returned ${data.topics.length} topic${data.topics.length === 1 ? "" : "s"}`;
    if (data.announcements && Array.isArray(data.announcements)) return `Returned ${data.announcements.length} announcement${data.announcements.length === 1 ? "" : "s"}`;
    if (data.submissions && Array.isArray(data.submissions)) return `Returned ${data.submissions.length} submission${data.submissions.length === 1 ? "" : "s"}`;
    if (data.students && Array.isArray(data.students)) return `Returned ${data.students.length} student${data.students.length === 1 ? "" : "s"}`;
    if (data.teachers && Array.isArray(data.teachers)) return `Returned ${data.teachers.length} teacher${data.teachers.length === 1 ? "" : "s"}`;
    if (data.guardians && Array.isArray(data.guardians)) return `Returned ${data.guardians.length} guardian${data.guardians.length === 1 ? "" : "s"}`;
    if (data.profiles && Array.isArray(data.profiles)) return `Listed ${data.profiles.length} profile${data.profiles.length === 1 ? "" : "s"}`;
    if (data.comments && Array.isArray(data.comments)) return `Returned ${data.comments.length} comment${data.comments.length === 1 ? "" : "s"}`;
    if (data.loggedIn) return `Logged in to profile '${data.profile}'`;
    if (data.loggedOut) return `Logged out of profile '${data.profile}'`;
    if (data.created) return `Created ${data.name || data.title || data.profile || "resource"}`;
    if (data.updated) return `Updated ${data.name || data.id || "resource"}`;
    if (data.removed) return `Removed ${data.profile || data.email || "resource"}`;
    if (data.selected) return `Selected course ${data.name || data.id}`;
    if (data.deselected) return "Cleared active course context";
    if (data.turnedIn) return `Turned in assignment ${data.courseWorkId || data.id || ""}`.trim();
    if (data.submitted) return `Submitted assignment ${data.courseWorkId || data.id || ""}`.trim();
    if (data.unsubmitted) return `Unsubmitted assignment ${data.courseWorkId || data.id || ""}`.trim();
    if (data.posted) return "Comment/announcement posted successfully";
    if (data.title) return `Retrieved: ${data.title}`;
    if (data.name) return `Retrieved: ${data.name}`;
    if (data.id) return `Resource ID: ${data.id}`;
  }
  return "Success";
}

let activeTracker: AuditTracker | null = null;

export function setActiveAuditTracker(tracker: AuditTracker | null): void {
  activeTracker = tracker;
}

export function getActiveAuditTracker(): AuditTracker | null {
  return activeTracker;
}

export function recordAuditSummary(data: any): void {
  if (activeTracker) {
    activeTracker.setSummary(formatResultSummary(data));
  }
}

export class AuditTracker {
  private startTime: number;
  private id: string;
  private noun: string;
  private verb?: string | undefined;
  private args: (string | number)[];
  private flags: Record<string, unknown>;
  private profile: string;
  private globals: GlobalFlags;
  private summary?: string | undefined;
  private isFinalized = false;

  constructor(argv: Record<string, any>, globals: GlobalFlags) {
    this.startTime = performance.now();
    this.id = `aud_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
    this.globals = globals;

    const rawArgs: (string | number)[] = Array.isArray(argv._) ? [...argv._] : [];
    this.args = sanitizeArgs(rawArgs);
    this.noun = String(this.args[0] || "help");
    this.verb = this.args[1] ? String(this.args[1]) : undefined;
    this.flags = sanitizeFlags(argv);

    try {
      const pm = new ProfileManager("classroom-cli");
      this.profile = pm.getActiveProfileName() || "default";
    } catch {
      this.profile = "default";
    }

    setActiveAuditTracker(this);
  }

  public setSummary(summary: string): void {
    this.summary = summary;
  }

  public getSummary(): string | undefined {
    return this.summary;
  }

  public success(summary?: string | undefined): void {
    if (this.isFinalized) return;
    this.isFinalized = true;
    const durationMs = Math.round((performance.now() - this.startTime) * 100) / 100;

    const record: AuditRecord = {
      id: this.id,
      timestamp: new Date().toISOString(),
      command: `classroom ${this.args.join(" ")}`.trim(),
      noun: this.noun,
      verb: this.verb,
      profile: this.profile,
      args: this.args,
      flags: this.flags,
      durationMs,
      status: "success",
      exitCode: 0,
      resultSummary: summary || this.summary || undefined,
      environment: {
        pid: process.pid,
        platform: process.platform,
        nodeVersion: process.version,
        isTTY: Boolean(process.stdout.isTTY),
        isAgent: Boolean(this.globals.json || !process.stdout.isTTY),
        ci: Boolean(process.env.CI),
      },
    };

    recordAuditLog(record);
  }

  public failure(err: any, exitCode = 1): void {
    if (this.isFinalized) return;
    this.isFinalized = true;
    const durationMs = Math.round((performance.now() - this.startTime) * 100) / 100;

    const errorDetails = {
      name: err?.name ? String(err.name) : "Error",
      code: err?.code ? String(err.code) : "ERR_GENERAL",
      message: err?.human || err?.message || String(err),
      hint: err?.hint ? String(err.hint) : undefined,
      stack: err?.stack ? String(err.stack) : undefined,
    };

    const record: AuditRecord = {
      id: this.id,
      timestamp: new Date().toISOString(),
      command: `classroom ${this.args.join(" ")}`.trim(),
      noun: this.noun,
      verb: this.verb,
      profile: this.profile,
      args: this.args,
      flags: this.flags,
      durationMs,
      status: "error",
      exitCode,
      error: errorDetails,
      environment: {
        pid: process.pid,
        platform: process.platform,
        nodeVersion: process.version,
        isTTY: Boolean(process.stdout.isTTY),
        isAgent: Boolean(this.globals.json || !process.stdout.isTTY),
        ci: Boolean(process.env.CI),
      },
    };

    recordAuditLog(record);
  }
}

export function readAuditLogs(options?: {
  limit?: number | undefined;
  fromDate?: Date | undefined;
  status?: "success" | "error" | undefined;
}): AuditRecord[] {
  const filePath = getAuditLogPath();
  if (!existsSync(filePath)) return [];

  try {
    const raw = readFileSync(filePath, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    const records: AuditRecord[] = [];

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as AuditRecord;
        if (options?.status && parsed.status !== options.status) continue;
        if (options?.fromDate && new Date(parsed.timestamp) < options.fromDate) continue;
        records.push(parsed);
        if (options?.limit && records.length >= options.limit) break;
      } catch {
        // Ignore corrupted lines
      }
    }

    return records;
  } catch {
    return [];
  }
}

export function clearAuditLogs(): void {
  const filePath = getAuditLogPath();
  if (existsSync(filePath)) {
    writeFileSync(filePath, "", { encoding: "utf-8", mode: 0o600 });
  }
}
