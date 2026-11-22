// Whether the machine has a connection, for the features that need one (Site Context, Sun Study's place
// search), and the reasons they give where they are off. A browser and the desktop app both report it
// through navigator.onLine, which is true unless the browser knows it is offline.

/** The reason an online-only row or field gives while the machine has no connection. */
export const NEEDS_INTERNET = "This needs an internet connection";

/** The reason a feature that runs on Rodeo's server gives in the desktop app, where there is no server. */
export const IN_BROWSER_ONLY = "This runs on rodeo.build, so it isn't in the desktop app: open rodeo.build in a browser to use it";

/** Whether the machine has a connection as far as the browser knows. */
export function online(): boolean {
  return navigator.onLine !== false;
}

/** Calls `fn` whenever the connection comes or goes; returns a function that stops it. */
export function onOnlineChange(fn: () => void): () => void {
  window.addEventListener("online", fn);
  window.addEventListener("offline", fn);
  return () => {
    window.removeEventListener("online", fn);
    window.removeEventListener("offline", fn);
  };
}
