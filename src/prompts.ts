import { formatTimeLeft, parseDueDate } from './date-utils.js';

export async function promptForCourse(courses: any[], message: string = 'Select a course:'): Promise<string | null> {
  const { select, isCancel, cancel } = await import('@clack/prompts');
  const courseOptions = courses.map((c: any) => ({
    value: c.id!,
    label: `${c.name}${c.section ? ` · ${c.section}` : ''}`,
    hint: `ID: ${c.id}`
  }));
  const chosenCourseId = await select({
    message,
    options: courseOptions
  });
  if (isCancel(chosenCourseId)) {
    cancel('Action cancelled.');
    return null;
  }
  return chosenCourseId as string;
}

export async function promptForCourseWork(works: any[], message: string = 'Select an assignment:'): Promise<string | null> {
  const { select, isCancel, cancel } = await import('@clack/prompts');
  const taskOptions = works.map((w: any) => {
    let hint = `ID: ${w.id}`;
    if (w.dueDate) {
      const tDate = parseDueDate(w);
      const timeLeft = formatTimeLeft(tDate, new Date());
      hint += ` · Due: ${timeLeft}`;
    }
    return {
      value: w.id!,
      label: w.title || 'Untitled Assignment',
      hint
    };
  });

  const chosenTaskId = await select({
    message,
    options: taskOptions
  });

  if (isCancel(chosenTaskId)) {
    cancel('Action cancelled.');
    return null;
  }
  return chosenTaskId as string;
}
