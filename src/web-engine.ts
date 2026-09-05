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

export async function executeWebPostPrivateComment(
  profile: Profile,
  courseId: string,
  workId: string,
  text: string,
  globals: GlobalFlags
) {
  note(`Posting private comment via headless browser...`, globals);

  const base64CourseId = Buffer.from(courseId).toString('base64');
  const base64WorkId = Buffer.from(workId).toString('base64');
  const url = `https://classroom.google.com/c/${base64CourseId}/a/${base64WorkId}/details?hl=en`;

  const browser = await launchWebEngine(profile);

  try {
    const page = await browser.newPage();
    note(`Navigating to assignment...`, globals);
    await page.goto(url, { waitUntil: 'networkidle2' });

    note(`Locating private comments input...`, globals);
    
    const inputFound = await page.evaluate(async () => {
      for (let attempt = 0; attempt < 20; attempt++) {
        let card = document.querySelector('div.PeGHgb.jbH5ac') as HTMLElement | null;
        if (!card) {
          const all = Array.from(document.querySelectorAll('*')) as HTMLElement[];
          const heading = all.find(el => {
            const t = el.innerText?.trim().toLowerCase() || '';
            return /^\d+\s+private comments?$/i.test(t) || t === 'private comments' || /^\d+\s+comentarios?\s+privados?$/i.test(t) || t === 'comentarios privados';
          });
          if (heading) {
            let p: HTMLElement | null = heading.parentElement;
            while (p && p !== document.body) {
              if (!p.innerText.includes('Your work') && !p.innerText.includes('Class comments') && p.children.length > 1) {
                card = p;
                break;
              }
              p = p.parentElement;
            }
          }
        }

        const root = card || document.body;

        const inputs = Array.from(root.querySelectorAll('textarea, input, [contenteditable="true"], [role="textbox"]')) as HTMLElement[];
        const privateInput = inputs.find(el => {
          const placeholder = el.getAttribute('placeholder') || '';
          const aria = el.getAttribute('aria-label') || '';
          return /private comment|comentario privado|add comment to/i.test(placeholder) || /private comment|comentario privado|add comment to/i.test(aria);
        }) || inputs[0];

        if (privateInput) {
          privateInput.focus();
          privateInput.click();
          return true;
        }

        const clickablePlaceholders = Array.from(root.querySelectorAll('div, span, button')) as HTMLElement[];
        const placeholderEl = clickablePlaceholders.find(el => {
          const t = el.innerText?.trim() || '';
          const a = el.getAttribute('aria-label') || '';
          return (/Add private comment|Añadir un comentario privado|Add comment to/i.test(t) || /Add private comment|Añadir un comentario privado|Add comment to/i.test(a)) && !el.querySelector('textarea, input, [contenteditable="true"]');
        });

        if (placeholderEl) {
          placeholderEl.click();
          placeholderEl.focus();
          return true;
        }

        await new Promise(r => setTimeout(r, 500));
      }
      return false;
    });

    if (!inputFound) {
      throw new Error('Could not find "Private comments" input box on the assignment page.');
    }

    await new Promise(r => setTimeout(r, 800));

    note(`Typing private comment...`, globals);
    
    await page.evaluate((msg) => {
      const active = document.activeElement as HTMLElement;
      if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
        (active as HTMLInputElement).value = msg;
        active.dispatchEvent(new Event('input', { bubbles: true }));
        active.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (active && (active.getAttribute('contenteditable') === 'true' || active.getAttribute('role') === 'textbox')) {
        active.innerText = msg;
        active.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, text);

    await page.keyboard.type(' ');
    await page.keyboard.press('Backspace');

    await new Promise(r => setTimeout(r, 1000));

    note(`Looking for Post button...`, globals);
    const posted = await page.evaluate(async () => {
      for (let attempt = 0; attempt < 20; attempt++) {
        const card = document.querySelector('div.PeGHgb.jbH5ac') || document.body;
        const buttons = Array.from(card.querySelectorAll('button, div[role="button"]')) as HTMLElement[];
        const postBtn = buttons.find(b => {
          const aria = b.getAttribute('aria-label') || '';
          const title = b.getAttribute('data-tooltip') || '';
          const text = b.innerText?.trim() || '';
          const isDisabled = b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true';
          return (/Post/i.test(text) || /Post/i.test(aria) || /Post/i.test(title) || /Send/i.test(aria) || /Publicar/i.test(text)) && !isDisabled;
        });

        if (postBtn) {
          postBtn.click();
          return true;
        }
        await new Promise(r => setTimeout(r, 500));
      }
      return false;
    });

    if (!posted) {
      await page.keyboard.press('Enter');
    }

    note(`Waiting for comment to be posted...`, globals);
    await new Promise(r => setTimeout(r, 3000));

    emit({ success: true, courseId, workId, comment: text, webFallbackUsed: true }, globals, () => {
      console.log(pc.green(`✔ Successfully posted private comment via Web Engine.`));
    });
  } catch (error: any) {
    throw new AppError('WEB_AUTOMATION_FAILED', {
      name: 'WebAutomationFailed',
      human: 'Failed to post private comment via web automation.',
      hint: error.message
    });
  } finally {
    await browser.close();
  }
}

export async function executeWebListPrivateComments(
  profile: Profile,
  courseId: string,
  workId: string,
  globals: GlobalFlags
) {
  note(`Fetching private comments via headless browser...`, globals);

  const base64CourseId = Buffer.from(courseId).toString('base64');
  const base64WorkId = Buffer.from(workId).toString('base64');
  const url = `https://classroom.google.com/c/${base64CourseId}/a/${base64WorkId}/details?hl=en`;

  const browser = await launchWebEngine(profile);

  try {
    const page = await browser.newPage();
    note(`Navigating to assignment...`, globals);
    await page.goto(url, { waitUntil: 'networkidle2' });

    await new Promise(r => setTimeout(r, 2500));

    const comments = await page.evaluate(() => {
      // 1. Locate the private comments card
      let card = document.querySelector('div.PeGHgb.jbH5ac') as HTMLElement | null;
      if (!card) {
        const all = Array.from(document.querySelectorAll('*')) as HTMLElement[];
        const heading = all.find(el => {
          const t = el.innerText?.trim().toLowerCase() || '';
          return /^\d+\s+private comments?$/i.test(t) || t === 'private comments' || /^\d+\s+comentarios?\s+privados?$/i.test(t) || t === 'comentarios privados';
        });
        if (heading) {
          let p: HTMLElement | null = heading.parentElement;
          while (p && p !== document.body) {
            if (!p.innerText.includes('Your work') && !p.innerText.includes('Class comments') && p.children.length > 1) {
              card = p;
              break;
            }
            p = p.parentElement;
          }
        }
      }

      if (!card) return [];

      const rawText = card.innerText || '';
      const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

      const ignored = /^(private comments?|\d+\s+private comments?|no private comments?|comentarios?\s+privados?|\d+\s+comentarios?\s+privados?|more_vert|more options|delete|eliminar|add private comment.*|add comment to .*|añadir un comentario privado.*|añadir comentario a .*|post|publicar|cancel|cancelar|private comments are only visible.*|los comentarios privados solo son visibles.*)$/i;

      const validLines = lines.filter(l => !ignored.test(l));

      const parsedComments: { author?: string; text: string; time?: string }[] = [];
      
      for (let i = 0; i < validLines.length; i++) {
        const line = validLines[i];
        if (line.includes('•') || line.includes('·')) {
          const parts = line.split(/[•·]/).map(p => p.trim());
          const author = parts[0];
          const time = parts[1];
          const text = validLines[i + 1] || '';
          parsedComments.push({ author, time, text });
          i++;
        } else {
          parsedComments.push({ text: line });
        }
      }

      return parsedComments;
    });

    emit({ courseId, workId, comments, count: comments.length, webFallbackUsed: true }, globals, (data) => {
      if (data.comments.length === 0) {
        console.log(pc.yellow('No private comments found on this assignment.'));
        return;
      }
      console.log(pc.bold(pc.cyan(`\n💬 Private Comments (${data.comments.length}):`)));
      for (const c of data.comments) {
        console.log(`\n  ${pc.bold(c.author || 'User')} ${c.time ? pc.dim(`(${c.time})`) : ''}`);
        console.log(`  ${c.text}`);
      }
      console.log('');
    });
  } catch (error: any) {
    throw new AppError('WEB_AUTOMATION_FAILED', {
      name: 'WebAutomationFailed',
      human: 'Failed to list private comments via web automation.',
      hint: error.message
    });
  } finally {
    await browser.close();
  }
}

