/** UTC day key "YYYY-MM-DD" for a millisecond timestamp. */
export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
export const startOfDayMs = (day) => Date.parse(`${day}T00:00:00.000Z`);
export const DAY_MS = 86_400_000;
