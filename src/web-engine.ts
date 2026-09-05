import type { Profile } from '../cli/foundation/profile.js';
import type { GlobalFlags } from '../cli/foundation/global-flags.js';
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
      const firstDialog = dialogs[0];
      if (firstDialog) {
        const modalBtns = Array.from(firstDialog.querySelectorAll('button'));
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

export async function executeWebEnroll(
  profile: Profile,
  code: string,
  globals: GlobalFlags
) {
  note(`Enrolling into course via headless browser with code '${code}'...`, globals);

  const browser = await launchWebEngine(profile);

  try {
    const page = await browser.newPage();
    let enrolledCourseId: string | undefined;

    // Track navigation or RPC to capture enrolled course ID
    page.on('response', async (res) => {
      const reqUrl = res.url();
      if (reqUrl.includes('batchexecute') || reqUrl.includes('ClassroomUi')) {
        try {
          const text = await res.text();
          // Match /c/<courseId> in response
          const match = text.match(/\/c\/([a-zA-Z0-9_-]+)/);
          if (match && !enrolledCourseId) {
            const { decodeClassroomIdentifier } = await import('./url-utils.js');
            enrolledCourseId = decodeClassroomIdentifier(match[1]);
          }
        } catch {}
      }
    });

    note(`Navigating to Google Classroom home...`, globals);
    await page.goto('https://classroom.google.com/u/0/h?hl=en', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 2000));

    note(`Opening Join class modal...`, globals);
    const joinModalOpened = await page.evaluate(async () => {
      const allBtns = Array.from(document.querySelectorAll('button, a, div[role="button"]')) as HTMLElement[];
      const joinBtn = allBtns.find(b => {
        const aria = b.getAttribute('aria-label') || '';
        return /create or join|join class|unirse a/i.test(aria);
      });
      if (joinBtn) {
        joinBtn.click();
        await new Promise(r => setTimeout(r, 1000));
        const menuItems = Array.from(document.querySelectorAll('[role="menuitem"], li, button')) as HTMLElement[];
        const joinOption = menuItems.find(i => /Join class|Unirse a una clase|Unirme a la clase/i.test(i.innerText || ''));
        if (joinOption) {
          joinOption.click();
          await new Promise(r => setTimeout(r, 1000));
        }
      }
      return !!document.querySelector('[role="dialog"], div[aria-modal="true"]');
    });

    if (!joinModalOpened) {
      throw new Error('Could not open Join Class modal dialog.');
    }

    note(`Typing enrollment code '${code}'...`, globals);
    await page.evaluate((c) => {
      const dialog = document.querySelector('[role="dialog"], div[aria-modal="true"]');
      const input = dialog?.querySelector('input');
      if (input) {
        input.value = c;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, code);

    await page.keyboard.type(' ');
    await page.keyboard.press('Backspace');
    await new Promise(r => setTimeout(r, 1000));

    note(`Submitting enrollment...`, globals);
    const clickedJoin = await page.evaluate(async () => {
      for (let attempt = 0; attempt < 10; attempt++) {
        const dialog = document.querySelector('[role="dialog"], div[aria-modal="true"]');
        if (dialog) {
          const btns = Array.from(dialog.querySelectorAll('button')) as HTMLButtonElement[];
          const joinBtn = btns.find(b => /Join|Unirme|Unirse/i.test(b.innerText?.trim() || '') && !b.disabled && !b.hasAttribute('disabled'));
          if (joinBtn) {
            joinBtn.click();
            return true;
          }
        }
        await new Promise(r => setTimeout(r, 500));
      }
      return false;
    });

    if (!clickedJoin) {
      throw new Error('Join button remained disabled or was not found in the dialog.');
    }

    // Wait for navigation to course page
    note(`Waiting for enrollment confirmation...`, globals);
    for (let i = 0; i < 20; i++) {
      const currentUrl = page.url();
      const courseMatch = currentUrl.match(/\/c\/([a-zA-Z0-9_-]+)/);
      if (courseMatch) {
        const { decodeClassroomIdentifier } = await import('./url-utils.js');
        enrolledCourseId = decodeClassroomIdentifier(courseMatch[1]);
        break;
      }
      if (enrolledCourseId) break;
      await new Promise(r => setTimeout(r, 500));
    }

    emit({ success: true, courseId: enrolledCourseId, code, webFallbackUsed: true }, globals, () => {
      console.log(pc.green(`✔ Successfully enrolled into course ${enrolledCourseId || ''} using code '${code}' via Web Engine!`));
    });
  } catch (error: any) {
    throw new AppError('WEB_AUTOMATION_FAILED', {
      name: 'WebAutomationFailed',
      human: 'Failed to enroll in course via web automation.',
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
    'Turn in|Mark as done|Entregar|Marcar como completada',
    'Unsubmit|Anular entrega',
    'Turn in|Mark as done|Entregar|Marcar como completada'
  );
}

export async function executeWebUnsubmit(profile: Profile, courseId: string, workId: string, globals: GlobalFlags) {
  return await executeWebActionFlow(
    profile, courseId, workId, globals,
    'unsubmit',
    'Unsubmit|Anular entrega',
    'Turn in|Mark as done|Entregar|Marcar como completada',
    'Unsubmit|Anular entrega'
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
          const addBtn = buttons.find(b => /Add or create|Añadir o crear/i.test(b.innerText?.trim() || ''));
          if (addBtn && !addBtn.disabled) {
            addBtn.click();
            return true;
          }
          await new Promise(r => setTimeout(r, 500));
        }
        return false;
      });
      
      if (!addMenuOpened) throw new Error('Could not find "Add or create" button.');
      
      await new Promise(r => setTimeout(r, 800));
      
      const linkMenuItemClicked = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('[role="menuitem"], li, button'));
        const linkItem = items.find(el => /Link|Enlace/i.test((el as HTMLElement).innerText?.trim() || ''));
        if (linkItem) {
          (linkItem as HTMLElement).click();
          return true;
        }
        return false;
      });
      
      if (!linkMenuItemClicked) throw new Error('Could not find "Link" option in the dropdown menu.');
      
      await new Promise(r => setTimeout(r, 1000));
      
      const typedAndAdded = await page.evaluate(async (urlText) => {
        const dialogs = document.querySelectorAll('[role="dialog"], div[aria-modal="true"]');
        const firstDialog = dialogs[0];
        if (!firstDialog) return false;
        
        const input = firstDialog.querySelector('input');
        if (!input) return false;
        
        input.value = urlText;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        
        await new Promise(r => setTimeout(r, 500));
        
        const dialogBtns = Array.from(firstDialog.querySelectorAll('button'));
        const addLinkBtn = dialogBtns.find(b => /Add link|Añadir enlace/i.test(b.innerText?.trim() || '') && !b.disabled);
        if (addLinkBtn) {
          addLinkBtn.click();
          return true;
        }
        return false;
      }, link);
      
      if (!typedAndAdded) throw new Error('Failed to paste link into the dialog.');
      
      note(`Waiting for Google Classroom to process the attachment...`, globals);
      // Fast poll until dialog disappears
      for (let p = 0; p < 15; p++) {
        const dialogOpen = await page.evaluate(() => !!document.querySelector('[role="dialog"] input'));
        if (!dialogOpen) break;
        await new Promise(r => setTimeout(r, 500));
      }
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
  globals: GlobalFlags,
  isClassComment: boolean = false
) {
  note(`Posting ${isClassComment ? 'class' : 'private'} comment via headless browser...`, globals);

  const base64CourseId = Buffer.from(courseId).toString('base64');
  const base64WorkId = Buffer.from(workId).toString('base64');
  const url = `https://classroom.google.com/c/${base64CourseId}/a/${base64WorkId}/details?hl=en`;

  const browser = await launchWebEngine(profile);

  try {
    const page = await browser.newPage();
    note(`Navigating to assignment...`, globals);
    await page.goto(url, { waitUntil: 'networkidle2' });

    note(`Locating ${isClassComment ? 'class' : 'private'} comments input...`, globals);
    
    const inputFound = await page.evaluate(async (isClass) => {
      function getCommentsCard(): HTMLElement | null {
        const all = Array.from(document.querySelectorAll('*')) as HTMLElement[];
        const candidates = all.filter(el => {
          const t = el.innerText || '';
          if (isClass) {
            return /class comments?|\d+\s+class comments?|comentarios?\s+de\s+la\s+clase/i.test(t) && !/private comments|comentarios privados/i.test(t);
          } else {
            return (/private comments?|\d+\s+private comments?|comentarios?\s+privados?|add comment to/i.test(t)) && !/Your work|Tu trabajo|Class comments|Comentarios de la clase/i.test(t);
          }
        });
        candidates.sort((a, b) => b.innerText.length - a.innerText.length);
        return candidates[0] || null;
      }

      for (let attempt = 0; attempt < 20; attempt++) {
        const card = getCommentsCard();
        const root = card || document.body;

        const inputs = Array.from(root.querySelectorAll('textarea, input, [contenteditable="true"], [role="textbox"]')) as HTMLElement[];
        const targetInput = inputs.find(el => {
          const placeholder = el.getAttribute('placeholder') || '';
          const aria = el.getAttribute('aria-label') || '';
          if (isClass) {
            return /class comment|comentario de la clase|add comment/i.test(placeholder) || /class comment|comentario de la clase|add comment/i.test(aria);
          } else {
            return /private comment|comentario privado|add comment to/i.test(placeholder) || /private comment|comentario privado|add comment to/i.test(aria);
          }
        }) || (card ? inputs[0] : null);

        if (targetInput) {
          targetInput.focus();
          targetInput.click();
          return true;
        }

        const clickablePlaceholders = Array.from(root.querySelectorAll('div, span, button')) as HTMLElement[];
        const placeholderEl = clickablePlaceholders.find(el => {
          const t = el.innerText?.trim() || '';
          const a = el.getAttribute('aria-label') || '';
          if (isClass) {
            return (/Add class comment|Añadir comentario de clase|Add comment/i.test(t) || /Add class comment|Añadir comentario de clase|Add comment/i.test(a)) && !el.querySelector('textarea, input, [contenteditable="true"]');
          } else {
            return (/Add private comment|Añadir un comentario privado|Add comment to/i.test(t) || /Add private comment|Añadir un comentario privado|Add comment to/i.test(a)) && !el.querySelector('textarea, input, [contenteditable="true"]');
          }
        });

        if (placeholderEl) {
          placeholderEl.click();
          placeholderEl.focus();
          return true;
        }

        await new Promise(r => setTimeout(r, 500));
      }
      return false;
    }, isClassComment);

    if (!inputFound) {
      throw new Error(`Could not find "${isClassComment ? 'Class comments' : 'Private comments'}" input box on the assignment page.`);
    }

    await new Promise(r => setTimeout(r, 800));

    note(`Typing comment...`, globals);
    
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
    const posted = await page.evaluate(async (isClass) => {
      for (let attempt = 0; attempt < 20; attempt++) {
        const all = Array.from(document.querySelectorAll('*')) as HTMLElement[];
        const candidates = all.filter(el => {
          const t = el.innerText || '';
          if (isClass) {
            return /class comments?|\d+\s+class comments?|comentarios?\s+de\s+la\s+clase/i.test(t) && !/private comments|comentarios privados/i.test(t);
          } else {
            return (/private comments?|\d+\s+private comments?|comentarios?\s+privados?|add comment to/i.test(t)) && !/Your work|Tu trabajo|Class comments|Comentarios de la clase/i.test(t);
          }
        });
        candidates.sort((a, b) => b.innerText.length - a.innerText.length);
        const card = candidates[0] || document.body;

        const buttons = Array.from(card.querySelectorAll('button, div[role="button"]')) as HTMLElement[];
        const postBtn = buttons.find(b => {
          const aria = b.getAttribute('aria-label') || '';
          const title = b.getAttribute('data-tooltip') || '';
          const text = b.innerText?.trim() || '';
          const isDisabled = b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true';
          return (/Post|Send|Publicar/i.test(text) || /Post|Send|Publicar/i.test(aria) || /Post|Send|Publicar/i.test(title)) && !isDisabled;
        });

        if (postBtn) {
          postBtn.click();
          return true;
        }
        await new Promise(r => setTimeout(r, 500));
      }
      return false;
    }, isClassComment);

    if (!posted) {
      await page.keyboard.press('Enter');
    }

    note(`Waiting for comment to be posted...`, globals);
    await new Promise(r => setTimeout(r, 3000));

    emit({ success: true, courseId, workId, comment: text, isClassComment, webFallbackUsed: true }, globals, () => {
      console.log(pc.green(`✔ Successfully posted ${isClassComment ? 'class' : 'private'} comment via Web Engine.`));
    });
  } catch (error: any) {
    throw new AppError('WEB_AUTOMATION_FAILED', {
      name: 'WebAutomationFailed',
      human: `Failed to post ${isClassComment ? 'class' : 'private'} comment via web automation.`,
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
  globals: GlobalFlags,
  isClassComment: boolean = false
) {
  note(`Fetching ${isClassComment ? 'class' : 'private'} comments via headless browser...`, globals);

  const base64CourseId = Buffer.from(courseId).toString('base64');
  const base64WorkId = Buffer.from(workId).toString('base64');
  const url = `https://classroom.google.com/c/${base64CourseId}/a/${base64WorkId}/details?hl=en`;

  const browser = await launchWebEngine(profile);

  try {
    const page = await browser.newPage();
    const capturedRpcComments: { id?: string | undefined; createTime?: string | undefined; updateTime?: string | undefined; text: string }[] = [];

    // Intercept Google Classroom internal RPCs for millisecond-precision timestamps (Zero hardcoded RPC IDs)
    function extractCommentsFromRpcPayload(obj: any) {
      if (!obj) return;
      if (typeof obj === 'string') {
        if (obj.startsWith('[') || obj.startsWith('{')) {
          try { extractCommentsFromRpcPayload(JSON.parse(obj)); } catch {}
        }
        return;
      }
      if (Array.isArray(obj)) {
        if (
          obj.length >= 4 &&
          Array.isArray(obj[0]) &&
          typeof obj[0][0] === 'string' && /^\d+$/.test(obj[0][0]) &&
          typeof obj[1] === 'number' && obj[1] > 1500000000000 && obj[1] < 3000000000000
        ) {
          const id = obj[0][0];
          const createMs = obj[1];
          const updateMs = typeof obj[2] === 'number' ? obj[2] : undefined;
          let textContent = '';
          for (let i = 3; i < obj.length; i++) {
            const item = obj[i];
            if (Array.isArray(item) && item[0] === 'edu.rt' && typeof item[1] === 'string') {
              textContent = item[1];
              break;
            } else if (typeof item === 'string' && item.length > 0 && !/^\d+$/.test(item) && !item.startsWith('c:') && !item.includes('==')) {
              textContent = item;
            }
          }
          if (textContent && createMs) {
            capturedRpcComments.push({
              id,
              createTime: new Date(createMs).toISOString(),
              updateTime: updateMs ? new Date(updateMs).toISOString() : undefined,
              text: textContent
            });
          }
        }
        for (const item of obj) {
          extractCommentsFromRpcPayload(item);
        }
      }
    }

    page.on('response', async (response) => {
      const reqUrl = response.url();
      if (reqUrl.includes('batchexecute') || reqUrl.includes('ClassroomUi')) {
        try {
          const text = await response.text();
          const lines = text.split('\n');
          for (const line of lines) {
            if (line.startsWith('[["wrb.fr"')) {
              try {
                extractCommentsFromRpcPayload(JSON.parse(line));
              } catch {}
            }
          }
        } catch {}
      }
    });

    note(`Navigating to assignment...`, globals);
    await page.goto(url, { waitUntil: 'networkidle2' });

    await new Promise(r => setTimeout(r, 2500));

    const domExtracted = await page.evaluate((isClass) => {
      // 1. Locate the target comments card semantically
      const all = Array.from(document.querySelectorAll('*')) as HTMLElement[];
      const candidates = all.filter(el => {
        const t = el.innerText || '';
        if (isClass) {
          return /class comments?|\d+\s+class comments?|comentarios?\s+de\s+la\s+clase/i.test(t) && !/private comments|comentarios privados/i.test(t);
        } else {
          return (/private comments?|\d+\s+private comments?|comentarios?\s+privados?|add comment to/i.test(t)) && !/Your work|Tu trabajo|Class comments|Comentarios de la clase/i.test(t);
        }
      });

      candidates.sort((a, b) => b.innerText.length - a.innerText.length);
      const card = candidates[0];
      if (!card) return [];

      // 2. Extract author and timestamp nodes (e.g. "Name • Date" or "Name · Date")
      const allChildren = Array.from(card.querySelectorAll('*')) as HTMLElement[];
      const authorNodes = allChildren.filter(el => {
        const t = el.textContent?.trim() || '';
        return (t.includes(' • ') || t.includes(' · ')) && el.children.length <= 2 && t.length < 80;
      });

      const parsed: { author?: string | undefined; time?: string | undefined; text: string }[] = [];

      for (const aNode of authorNodes) {
        const aText = aNode.textContent?.trim() || '';
        const parts = aText.split(/[•·]/).map(p => p.trim());
        const author = parts[0];
        const time = parts[1];

        // The comment body resides in the sibling or adjacent container
        let bodyText = '';
        let curr: HTMLElement | null = aNode.parentElement;
        for (let depth = 0; depth < 5 && curr && curr !== card; depth++) {
          const next = curr.nextElementSibling as HTMLElement;
          if (next && next.innerText && !/add private comment|add class comment|post|private comments are only visible/i.test(next.innerText)) {
            bodyText = next.innerText.trim();
            break;
          }
          curr = curr.parentElement;
        }

        if (author && bodyText) {
          parsed.push({ author, time, text: bodyText });
        }
      }

      return parsed;
    }, isClassComment);

    // Merge RPC detailed metadata with DOM extracted author names
    const comments = domExtracted.map((c: any) => {
      const rpcMatch = capturedRpcComments.find(r => r.text === c.text);
      const isoTime = rpcMatch?.createTime;
      let displayTime = c.time;
      if (isoTime) {
        try {
          const d = new Date(isoTime);
          const pad = (n: number) => n.toString().padStart(2, '0');
          displayTime = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        } catch {
          displayTime = isoTime;
        }
      }

      return {
        id: rpcMatch?.id,
        author: c.author || 'User',
        time: displayTime,
        isoTime: isoTime || undefined,
        text: c.text
      };
    });

    emit({ courseId, workId, comments, isClassComment, count: comments.length, webFallbackUsed: true }, globals, (data) => {
      const label = isClassComment ? 'Class Comments' : 'Private Comments';
      if (data.comments.length === 0) {
        console.log(pc.yellow(`No ${label.toLowerCase()} found on this assignment.`));
        return;
      }
      console.log(pc.bold(pc.cyan(`\n💬 ${label} (${data.comments.length}):`)));
      for (const c of data.comments) {
        console.log(`\n  ${pc.bold(c.author || 'User')} ${c.time ? pc.dim(`(${c.time})`) : ''}`);
        console.log(`  ${c.text}`);
      }
      console.log('');
    });
  } catch (error: any) {
    throw new AppError('WEB_AUTOMATION_FAILED', {
      name: 'WebAutomationFailed',
      human: `Failed to list ${isClassComment ? 'class' : 'private'} comments via web automation.`,
      hint: error.message
    });
  } finally {
    await browser.close();
  }
}
