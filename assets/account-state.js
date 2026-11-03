export const BANK_VERSION = '2026-11-v2';

export function hasWork(snapshot) {
  return !!snapshot?.exams && Object.values(snapshot.exams).some(entry =>
    Object.keys(entry?.answers || {}).length || entry?.startedAt != null || entry?.resultsViewed === true);
}

export function chooseInitialState(local, remote) {
  if (!remote) return 'local';
  if (remote.bankVersion !== BANK_VERSION || remote.version !== 2) return 'incompatible';
  if (!hasWork(local)) return 'remote';
  if (!hasWork(remote)) return 'local';
  return JSON.stringify(local.exams) === JSON.stringify(remote.exams) ? 'local' : 'conflict';
}

export function attemptFromSnapshot(uid, examId, state) {
  const numericId = Number(examId);
  const entry = state?.exams?.[String(numericId)];
  if (!uid || !Number.isInteger(numericId) || numericId < 1 || numericId > 10
      || state?.bankVersion !== BANK_VERSION || !entry?.resultsViewed
      || !Number.isSafeInteger(entry.completedAt) || entry.completedAt <= 0) return null;
  const startedAt = Number.isSafeInteger(entry.startedAt) && entry.startedAt > 0 ? entry.startedAt : null;
  const elapsedMs = Number.isFinite(entry.elapsedMs) && entry.elapsedMs >= 0 ? entry.elapsedMs : 0;
  return {
    id:`e${numericId}-s${startedAt || 0}-c${entry.completedAt}`,
    data:{uid, examId:numericId, bankVersion:BANK_VERSION,
      answers:JSON.parse(JSON.stringify(entry.answers || {})), startedAt,
      completedAt:entry.completedAt, elapsedMs},
  };
}

export function queueAttempt(queue, attempt) {
  if (!attempt) return queue.slice();
  return [...queue.filter(item => item.id !== attempt.id), attempt].slice(-100);
}
