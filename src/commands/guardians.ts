import { AppError } from '../../cli/foundation/error-map.js';
import { emit, note } from '../../cli/agent/json-mode.js';
import type { GlobalFlags } from '../../cli/foundation/global-flags.js';
import { getClient } from '../client.js';
import pc from 'picocolors';
import { printBlock, type BlockItem } from '../ui.js';

export async function handleGuardians(verb: string | undefined, globals: GlobalFlags, argv: any) {
  const studentId = argv._[2];
  if (!studentId) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Student ID is required' });
  const classroom = await getClient();

  if (verb === 'list') {
    const res = await classroom.userProfiles.guardians.list({ studentId });
    const guardians = res.data.guardians || [];
    emit({ guardians }, globals, (data) => {
      if (data.guardians.length === 0) { 
        console.log(pc.yellow('No guardians found.')); 
        return; 
      }
      printBlock(data.guardians.map((g: any) => ({
        title: g.guardianProfile?.name?.fullName || 'Unknown',
        id: g.guardianId,
        details: [['Email', g.guardianProfile?.emailAddress || 'Unknown']]
      })));
    });
  } else if (verb === 'invite') {
    const email = argv['email'];
    if (!email) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: '--email is required' });
    const res = await classroom.userProfiles.guardianInvitations.create({ studentId, requestBody: { invitedEmailAddress: email } });
    emit({ invitation: res.data }, globals, () => console.log(`Invited ${email} as a guardian.`));
  } else {
    throw new AppError('UNKNOWN_COMMAND', { name: 'UnknownCommand', human: `Unknown guardian verb: ${verb}` });
  }
}
