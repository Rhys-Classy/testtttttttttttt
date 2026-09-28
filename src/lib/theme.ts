export const THEMES = ['dark', 'light', 'system'] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_COOKIE = 'bos_theme';

/** Dark unless the user picked something else. */
export function parseTheme(v: string | undefined | null): Theme {
  return (THEMES as readonly string[]).includes(v ?? '') ? (v as Theme) : 'dark';
}
