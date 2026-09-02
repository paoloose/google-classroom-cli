import pc from 'picocolors';

export interface BlockItem {
  title: string;
  id?: string;
  details?: [string, string][];
  attachments?: string[];
}

export function printBlock(items: BlockItem[]) {
  if (items.length === 0) return;
  console.log('');
  
  for (const item of items) {
    console.log(`${pc.cyan('●')} ${pc.bold(item.title)}`);
    
    const details = item.details || [];
    if (item.id) {
      details.unshift(['ID', item.id]);
    }
    
    if (details.length > 0) {
      const maxLen = Math.max(...details.map(d => d[0].length));
      for (const [k, v] of details) {
        console.log(`  ${pc.dim((k + ':').padEnd(maxLen + 1))} ${v}`);
      }
    }
    
    if (item.attachments && item.attachments.length > 0) {
      console.log(`  ${pc.dim('Attachments:')}`);
      for (const att of item.attachments) {
        console.log(`    ${att}`);
      }
    }
    
    console.log('');
  }
}
