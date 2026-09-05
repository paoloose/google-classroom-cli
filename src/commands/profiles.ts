import type { GlobalFlags } from '../../cli/foundation/global-flags.js';
import { AppError } from '../../cli/foundation/error-map.js';
import { emit, note } from '../../cli/agent/json-mode.js';
import { ProfileManager } from '../../cli/foundation/profile.js';

export async function handleProfile(verb: string | undefined, globals: GlobalFlags, argv: any) {
  const manager = new ProfileManager('classroom-cli');

  if (verb === 'list') {
    const profiles = manager.listProfiles();
    const active = manager.getActiveProfileName();
    
    emit({ profiles, active }, globals, () => {
      console.log('Profiles:');
      if (profiles.length === 0) {
        console.log('  (no profiles found)');
        return;
      }
      for (const p of profiles) {
        if (p === active) {
          console.log(`* ${p} (active)`);
        } else {
          console.log(`  ${p}`);
        }
      }
    });
  } else if (verb === 'add') {
    const name = argv._[2];
    if (!name) {
      throw new AppError('MISSING_PROFILE_NAME', {
        name: 'MissingProfileName',
        human: 'Profile name is required.',
        hint: 'Usage: classroom profile add <name>'
      });
    }
    manager.createProfile(name);
    emit({ created: true, profile: name }, globals, () => console.log(`Created profile '${name}'.`));
  } else if (verb === 'use') {
    const name = argv._[2];
    if (!name) {
      throw new AppError('MISSING_PROFILE_NAME', {
        name: 'MissingProfileName',
        human: 'Profile name is required.',
        hint: 'Usage: classroom profile use <name>'
      });
    }
    try {
      manager.setActiveProfile(name);
      emit({ active: name }, globals, () => console.log(`Switched to profile '${name}'.`));
    } catch (e: any) {
       throw new AppError('PROFILE_ERROR', {
          name: 'ProfileError',
          human: e.message
       });
    }
  } else if (verb === 'remove') {
    const name = argv._[2];
    if (!name) {
      throw new AppError('MISSING_PROFILE_NAME', {
        name: 'MissingProfileName',
        human: 'Profile name is required.',
        hint: 'Usage: classroom profile remove <name>'
      });
    }
    manager.removeProfile(name);
    emit({ removed: true, profile: name }, globals, () => console.log(`Removed profile '${name}'.`));
  } else {
    throw new AppError('UNKNOWN_COMMAND', {
      name: 'UnknownCommand',
      human: `Unknown profile verb: ${verb}`
    });
  }
}
