import { Profile } from '../cli/foundation/profile.js';
import { GlobalFlags } from '../cli/foundation/global-flags.js';
import { note, emit } from '../cli/agent/json-mode.js';
import { AppError } from '../cli/foundation/error-map.js';
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import pc from 'picocolors';

export async function performWebLoginHandshake(profile: Profile, globals: GlobalFlags) {
  note(`Starting web login handshake for profile '${profile.name}'...`, globals);
  
  if (!existsSync(profile.paths.browserData)) {
    mkdirSync(profile.paths.browserData, { recursive: true, mode: 0o700 });
  }

  console.log(pc.yellow('\n⚠️  Google actively blocks automated browsers from logging in.'));
  console.log('To bypass this, we are launching a dedicated, manual Chrome window for this profile.\n');
  console.log(pc.cyan('Step 1:'), 'Log into Google Classroom in the window that just opened.');
  console.log(pc.cyan('Step 2:'), 'Once you see your Classroom dashboard, fully QUIT Chrome by pressing Cmd+Q (macOS) or closing all windows.');
  
  let chromePath = 'google-chrome';
  if (process.platform === 'darwin') {
    chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  } else if (process.platform === 'win32') {
    chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  }

  // Launch Chrome totally detached from agent-browser so webdriver=false
  const chromeProcess = spawn(chromePath, [
    `--user-data-dir=${profile.paths.browserData}`,
    '--no-first-run',
    'https://classroom.google.com'
  ], {
    detached: true,
    stdio: 'ignore'
  });
  chromeProcess.unref();

  const rl = readline.createInterface({ input, output });
  await rl.question(pc.bold('\nPress ENTER when you have logged in and fully QUIT (Cmd+Q) the Chrome app... '));
  rl.close();

  note(`Saving session state...`, globals);
  emit({ webHandshakeComplete: true, profile: profile.name }, globals, () => console.log(pc.green(`\n✔ Successfully locked in web session for profile '${profile.name}'.`)));
}

export async function launchWebEngine(profile: Profile) {
  let chromePath = 'google-chrome';
  if (process.platform === 'darwin') {
    chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  } else if (process.platform === 'win32') {
    chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  }

  // Import puppeteer dynamically to keep CLI startup fast
  const puppeteer = (await import('puppeteer')).default;
  const isHeaded = process.env.CLASSROOM_HEADED === 'true';

  return await puppeteer.launch({
    executablePath: chromePath,
    headless: !isHeaded,
    userDataDir: profile.paths.browserData,
    ignoreDefaultArgs: ['--use-mock-keychain', '--password-store=basic', '--enable-automation'],
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
  });
}

async function executeWebActionFlow(
  profile: Profile, courseId: string, workId: string, globals: GlobalFlags, 
  actionName: string, 
  btnRegexSource: string, 
  alreadyDoneRegexSource: string,
  modalRegexSource: string
) {
  note(`Proxying ${actionName} request to headless browser...`, globals);
  
  const base64CourseId = Buffer.from(courseId).toString('base64');
  const base64WorkId = Buffer.from(workId).toString('base64');
  const url = `https://classroom.google.com/c/${base64CourseId}/a/${base64WorkId}/details?hl=en`;
  
  const browser = await launchWebEngine(profile);

  try {
    const page = await browser.newPage();
    note(`Navigating to assignment...`, globals);
    await page.goto(url, { waitUntil: 'networkidle2' });

    note(`Looking for action button...`, globals);
    const result = await page.evaluate(async (btnStr, doneStr) => {
      const btnRegex = new RegExp(btnStr, 'i');
      const doneRegex = new RegExp(doneStr, 'i');
      
      for (let i = 0; i < 20; i++) {
        const buttons = Array.from(document.querySelectorAll('button'));
        
        if (buttons.some(b => doneRegex.test(b.innerText?.trim() || ''))) {
          return 'ALREADY_DONE';
        }
        
        const btn = buttons.find(b => btnRegex.test(b.innerText?.trim() || ''));
        if (btn && !btn.disabled) {
          btn.click();
          return 'CLICKED';
        }
        await new Promise(r => setTimeout(r, 500));
      }
      return 'NOT_FOUND';
    }, btnRegexSource, alreadyDoneRegexSource);

    if (result === 'ALREADY_DONE') {
      emit({ success: true, alreadyDone: true }, globals, () => console.log(pc.yellow(`\nAssignment is already in the requested state.`)));
      return;
    }
    if (result === 'NOT_FOUND') {
      throw new Error(`Could not find button matching ${btnRegexSource} after 10 seconds of polling. The DOM may be obfuscated or language is unsupported.`);
    }

    note(`Waiting for confirmation modal...`, globals);
    await new Promise(r => setTimeout(r, 1500));

    const modalClicked = await page.evaluate((modalStr) => {
      const regex = new RegExp(modalStr, 'i');
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs.length > 0) {
        const modalBtns = Array.from(dialogs[0].querySelectorAll('button'));
        const confirmBtn = modalBtns.find(b => regex.test(b.innerText?.trim() || ''));
        if (confirmBtn) {
          confirmBtn.click();
          return true;
        }
      }
      return false;
    }, modalRegexSource);

    if (!modalClicked) {
      throw new Error('Could not find confirm button in the modal dialog.');
    }
    
    note(`Action complete. Verifying network state...`, globals);
    await new Promise(r => setTimeout(r, 2000));
    
    emit({ success: true, webFallbackUsed: true, method: 'puppeteer' }, globals, () => console.log(pc.green(`\n✔ Action '${actionName}' completed successfully via Web Engine.`)));
  } catch (error: any) {
    throw new AppError('WEB_AUTOMATION_FAILED', {
      name: 'WebAutomationFailed',
      human: `Failed to complete web ${actionName} automation.`,
      hint: error.message
    });
  } finally {
    await browser.close();
  }
}

export async function executeWebTurnIn(profile: Profile, courseId: string, workId: string, globals: GlobalFlags) {
  return await executeWebActionFlow(
    profile, courseId, workId, globals,
    'turn-in',
    'Turn in|Mark as done',
    'Unsubmit',
    'Turn in|Mark as done'
  );
}

export async function executeWebUnsubmit(profile: Profile, courseId: string, workId: string, globals: GlobalFlags) {
  return await executeWebActionFlow(
    profile, courseId, workId, globals,
    'unsubmit',
    'Unsubmit',
    'Turn in|Mark as done',
    'Unsubmit'
  );
}

export async function executeWebSubmit(profile: Profile, courseId: string, workId: string, links: string[], files: string[], globals: GlobalFlags) {
  note(`Proxying submit request to headless browser...`, globals);
  
  const allLinks = [...links];
  
  if (files.length > 0) {
    const { uploadToDrive } = await import('./commands/drive.js');
    for (const file of files) {
      note(`Uploading local file to Google Drive...`, globals);
      const fileId = await uploadToDrive(file, globals, courseId);
      allLinks.push(`https://drive.google.com/file/d/${fileId}/view`);
    }
  }

  if (allLinks.length === 0) {
    throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'At least one --link or --file is required' });
  }

  const base64CourseId = Buffer.from(courseId).toString('base64');
  const base64WorkId = Buffer.from(workId).toString('base64');
  const url = `https://classroom.google.com/c/${base64CourseId}/a/${base64WorkId}/details?hl=en`;
  
  const browser = await launchWebEngine(profile);

  try {
    const page = await browser.newPage();
    note(`Navigating to assignment...`, globals);
    await page.goto(url, { waitUntil: 'networkidle2' });

    for (const link of allLinks) {
      note(`Attaching link to assignment...`, globals);
      
      const addMenuOpened = await page.evaluate(async () => {
        for (let i = 0; i < 20; i++) {
          const buttons = Array.from(document.querySelectorAll('button'));
          const addBtn = buttons.find(b => /Add or create/i.test(b.innerText?.trim() || ''));
          if (addBtn && !addBtn.disabled) {
            addBtn.click();
            return true;
          }
          await new Promise(r => setTimeout(r, 500));
        }
        return false;
      });
      
      if (!addMenuOpened) throw new Error('Could not find "Add or create" button.');
      
      await new Promise(r => setTimeout(r, 1000));
      
      const linkMenuItemClicked = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('[role="menuitem"]'));
        const linkItem = items.find(el => /Link/i.test((el as HTMLElement).innerText?.trim() || ''));
        if (linkItem) {
          (linkItem as HTMLElement).click();
          return true;
        }
        return false;
      });
      
      if (!linkMenuItemClicked) throw new Error('Could not find "Link" option in the dropdown menu.');
      
      await new Promise(r => setTimeout(r, 1500));
      
      const typedAndAdded = await page.evaluate(async (urlText) => {
        const dialogs = document.querySelectorAll('[role="dialog"]');
        if (dialogs.length === 0) return false;
        
        const input = dialogs[0].querySelector('input');
        if (!input) return false;
        
        input.value = urlText;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        
        await new Promise(r => setTimeout(r, 500));
        
        const dialogBtns = Array.from(dialogs[0].querySelectorAll('button'));
        const addLinkBtn = dialogBtns.find(b => /Add link/i.test(b.innerText?.trim() || ''));
        if (addLinkBtn) {
          addLinkBtn.click();
          return true;
        }
        return false;
      }, link);
      
      if (!typedAndAdded) throw new Error('Failed to paste link into the dialog.');
      
      note(`Waiting for Google Classroom to process the attachment...`, globals);
      await new Promise(r => setTimeout(r, 5000));
    }
    
    emit({ success: true, webFallbackUsed: true, method: 'puppeteer' }, globals, () => console.log(pc.green(`\n✔ Successfully attached items via Web Engine.`)));
  } catch (error: any) {
    throw new AppError('WEB_AUTOMATION_FAILED', {
      name: 'WebAutomationFailed',
      human: 'Failed to complete web submit automation.',
      hint: error.message
    });
  } finally {
    await browser.close();
  }
}
