// Shared by the service and the browser-evaluated dashboard script.
export const NOTEBOOK_HOSTS = ["notebooklm.google.com", "notebook.google.com"];
export const NOTEBOOK_SIGN_IN_PATH = /^\/(?:u\/\d+\/)?(?:trynow|login|signin)(?:\/|$)/i;

export function isNotebookAppUrl(value: string | URL): boolean {
  try {
    const url = typeof value === "string" ? new URL(value) : value;
    return url.protocol === "https:" && NOTEBOOK_HOSTS.includes(url.hostname) &&
      !NOTEBOOK_SIGN_IN_PATH.test(url.pathname);
  } catch {
    return false;
  }
}
