export type Theme = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "theme";
export const THEME_CHANGE_EVENT = "theme-change";

/**
 * Runs in <head> before paint so the first frame already has the right
 * `.dark` class. Kept dependency-free because it is inlined as a string.
 */
export const themeBootstrapScript = `document.documentElement.classList.remove("dark")`;
