import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getAppPaths, ensureHome } from '../cli/foundation/xdg-paths.js';
import { AppError } from '../cli/foundation/error-map.js';

export interface ActiveCourse {
  id: string;
  name: string;
  section?: string;
  selectedAt: string;
}

const paths = getAppPaths('classroom-cli');
const contextFilePath = join(paths.state, 'active-course.json');

export function getActiveCourse(): ActiveCourse | null {
  try {
    if (!existsSync(contextFilePath)) return null;
    const raw = readFileSync(contextFilePath, 'utf-8');
    const data = JSON.parse(raw);
    if (data && typeof data === 'object' && typeof data.id === 'string') {
      return data as ActiveCourse;
    }
    return null;
  } catch {
    return null;
  }
}

export function setActiveCourse(course: { id: string; name: string; section?: string }): ActiveCourse {
  ensureHome(paths);
  const active: ActiveCourse = {
    id: course.id,
    name: course.name,
    section: course.section,
    selectedAt: new Date().toISOString()
  };
  writeFileSync(contextFilePath, JSON.stringify(active, null, 2), { mode: 0o600 });
  return active;
}

export function clearActiveCourse(): boolean {
  try {
    if (existsSync(contextFilePath)) {
      unlinkSync(contextFilePath);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function resolveCourseId(explicitId?: string): string {
  if (explicitId) return explicitId;
  const active = getActiveCourse();
  if (active?.id) return active.id;
  throw new AppError('MISSING_ARG', {
    name: 'MissingCourseId',
    human: 'Course ID is required.',
    hint: 'Pass a course ID or select one using `classroom course select`.'
  });
}
