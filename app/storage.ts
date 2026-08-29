/**
 * The one place this app touches the browser's storage.
 *
 * Everything here is best-effort by design. A private window, a browser set to
 * block site data, a full quota, or a device policy can each make reading or
 * writing throw, and none of those is a reason a learner should be unable to
 * work a proof. So a failed read is no progress, a failed write is reported
 * once and then let go, and the proof screen never depends on either.
 *
 * The key carries a version. When the stored shape changes, the old key is
 * simply not read: `progress.ts` already drops entries it cannot verify, and a
 * migration path for data that has never left this machine would be more
 * machinery than the problem deserves.
 */

import { PROGRESS_VERSION, readProgress, type Progress, type ProgressReading } from './progress.ts';

export const STORAGE_KEY = `group-equation-explorer/progress/v${PROGRESS_VERSION}`;

/** Bounds the parse work a hand-edited store can cause. */
const MAX_STORED_CHARACTERS = 200_000;

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadProgress(): ProgressReading | null {
  const local = store();
  if (!local) return null;

  let text: string | null;
  try {
    text = local.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (text === null || text.length > MAX_STORED_CHARACTERS) return null;

  try {
    return readProgress(JSON.parse(text));
  } catch {
    // Unreadable rather than merely unverifiable: nothing to salvage.
    return null;
  }
}

/** Whether the write landed. The caller decides whether to say so. */
export function saveProgress(progress: Progress): boolean {
  const local = store();
  if (!local) return false;
  try {
    local.setItem(STORAGE_KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}

export function clearProgress(): boolean {
  const local = store();
  if (!local) return false;
  try {
    local.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
