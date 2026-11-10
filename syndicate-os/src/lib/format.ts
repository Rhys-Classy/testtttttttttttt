const pad = (value: number) => String(value).padStart(2, "0");

/** Current local time as HH:MM:SS. Call from effects and handlers, never during render. */
export function stamp(): string {
  const now = new Date();
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

/** Seconds as HH:MM:SS. */
export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${pad(hours)}:${pad(minutes)}:${pad(totalSeconds % 60)}`;
}

/** Thousands separators with a fixed locale, so server and browser agree. */
export function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}
