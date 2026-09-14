import type { GlobalFlags } from '../../cli/foundation/global-flags.js';
import { AppError } from '../../cli/foundation/error-map.js';
import { emit } from '../../cli/agent/json-mode.js';
import { readAuditLogs, clearAuditLogs, type AuditRecord } from '../../cli/foundation/audit.js';
import { resolveDateRange, applyDateFilter } from '../../cli/foundation/date-filter.js';
import pc from 'picocolors';

export async function handleAudit(verb: string | undefined, globals: GlobalFlags, argv: any) {
  if (verb === 'list' || !verb) {
    const limitArg = argv.limit ? parseInt(String(argv.limit), 10) : 50;
    const statusFilter = argv.status as 'success' | 'error' | undefined;
    
    let records = readAuditLogs({ limit: Math.max(100, limitArg), status: statusFilter });

    if (globals.from || globals.last) {
      const range = resolveDateRange(globals.from, globals.last);
      records = applyDateFilter(records, range, (r) => r.timestamp);
    }

    const finalRecords = records.slice(0, limitArg);

    emit(finalRecords, globals, () => {
      console.log(pc.bold(pc.white(`\n  📋 Audit Logs (${finalRecords.length} entries)`)));
      if (finalRecords.length === 0) {
        console.log(pc.dim('  (no audit logs recorded yet)\n'));
        return;
      }

      console.log('');
      for (const r of finalRecords) {
        const statusBadge = r.status === 'success' 
          ? pc.green('✓ OK   ') 
          : pc.red('✗ ERR  ');
        const duration = pc.dim(`${r.durationMs}ms`);
        const time = pc.cyan(new Date(r.timestamp).toLocaleTimeString());
        const date = pc.dim(new Date(r.timestamp).toISOString().slice(0, 10));
        const cmd = pc.bold(pc.white(r.command));
        const profile = pc.yellow(`[${r.profile}]`);

        console.log(`  ${statusBadge} ${date} ${time}  ${profile}  ${cmd}  ${duration}`);
        if (r.resultSummary) {
          console.log(`         ${pc.dim('↳')} ${pc.dim(r.resultSummary)}`);
        }
        if (r.error) {
          console.log(`         ${pc.red('↳')} ${pc.red(r.error.message)}`);
        }
      }
      console.log('');
    });
    return;
  }

  if (verb === 'tail') {
    const count = argv.n ? parseInt(String(argv.n), 10) : (argv._[2] ? parseInt(String(argv._[2]), 10) : 10);
    const records = readAuditLogs({ limit: count });

    emit(records, globals, () => {
      if (records.length === 0) {
        console.log(pc.dim('No audit logs recorded yet.'));
        return;
      }
      for (const r of records.reverse()) {
        const isOk = r.status === 'success';
        const symbol = isOk ? pc.green('✓') : pc.red('✗');
        console.log(`\n${symbol} ${pc.bold(r.id)} — ${pc.cyan(r.timestamp)} (${r.durationMs}ms)`);
        console.log(`  ${pc.dim('Command:')}  ${pc.white(r.command)}`);
        console.log(`  ${pc.dim('Profile:')}  ${r.profile}`);
        console.log(`  ${pc.dim('Status:')}   ${isOk ? pc.green('SUCCESS') : pc.red('ERROR (code: ' + r.exitCode + ')')}`);
        if (Object.keys(r.flags).length > 0) {
          console.log(`  ${pc.dim('Flags:')}    ${JSON.stringify(r.flags)}`);
        }
        if (r.resultSummary) {
          console.log(`  ${pc.dim('Summary:')}  ${r.resultSummary}`);
        }
        if (r.error) {
          console.log(`  ${pc.dim('Error:')}    ${pc.red(r.error.message)}`);
          if (r.error.hint) console.log(`  ${pc.dim('Hint:')}     ${pc.yellow(r.error.hint)}`);
          if (r.error.stack && globals.verbose) console.log(`  ${pc.dim('Stack:')}\n${pc.dim(r.error.stack)}`);
        }
      }
      console.log('');
    });
    return;
  }

  if (verb === 'clear') {
    clearAuditLogs();
    emit({ cleared: true }, globals, () => {
      console.log(pc.green('Audit logs cleared successfully.'));
    });
    return;
  }

  throw new AppError('UNKNOWN_COMMAND', {
    name: 'UnknownCommand',
    human: `Unknown audit verb: ${verb}`,
    hint: 'Supported verbs: classroom audit list, classroom audit tail, classroom audit clear'
  });
}
