import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { atomicWriteJson } from "./atomic-write.js";
import { getAppPaths, AppPaths } from "./xdg-paths.js";

export type Profile = {
  name: string;
  paths: {
    base: string;
    session: string;      // directory for oauth-session.json
    context: string;      // file for context.json
    browserState: string; // file for browser-state.json
    browserData: string;  // directory for user-data-dir
  };
};

export class ProfileManager {
  private paths: AppPaths;
  private activeProfileFile: string;

  constructor(appName: string = "classroom-cli") {
    this.paths = getAppPaths(appName);
    this.activeProfileFile = join(this.paths.config, "active-profile.json");
    // Ensure profiles directory exists
    if (!existsSync(this.paths.profiles)) {
      mkdirSync(this.paths.profiles, { recursive: true, mode: 0o700 });
    }
  }

  private buildProfilePaths(name: string): Profile {
    const base = join(this.paths.profiles, name);
    return {
      name,
      paths: {
        base,
        session: base, // session functions take a directory
        context: join(base, "context.json"),
        browserState: join(base, "browser-state.json"),
        browserData: join(base, "browser-data"),
      }
    };
  }

  public createProfile(name: string): Profile {
    const profile = this.buildProfilePaths(name);
    mkdirSync(profile.paths.base, { recursive: true, mode: 0o700 });
    return profile;
  }

  public listProfiles(): string[] {
    if (!existsSync(this.paths.profiles)) return [];
    return readdirSync(this.paths.profiles, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
  }

  public removeProfile(name: string): void {
    const profile = this.buildProfilePaths(name);
    if (existsSync(profile.paths.base)) {
      rmSync(profile.paths.base, { recursive: true, force: true });
    }
    const active = this.getActiveProfileName();
    if (active === name) {
      if (existsSync(this.activeProfileFile)) {
        rmSync(this.activeProfileFile, { force: true });
      }
    }
  }

  public setActiveProfile(name: string): void {
    const profile = this.buildProfilePaths(name);
    if (!existsSync(profile.paths.base)) {
      throw new Error(`Profile '${name}' does not exist.`);
    }
    atomicWriteJson(this.activeProfileFile, { name }, { mode: 0o600 });
  }

  public getActiveProfileName(): string | null {
    if (!existsSync(this.activeProfileFile)) return null;
    try {
      const data = JSON.parse(readFileSync(this.activeProfileFile, "utf8"));
      return data.name || null;
    } catch {
      return null;
    }
  }

  public getActiveProfile(): Profile | null {
    const name = this.getActiveProfileName();
    if (!name) return null;
    const profile = this.buildProfilePaths(name);
    if (!existsSync(profile.paths.base)) return null; // Orphaned reference
    return profile;
  }
}
