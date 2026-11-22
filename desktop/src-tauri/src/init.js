// Runs in the page before any of its scripts. Defines window.__rodeoShell, the page's whole
// view of the desktop shell (web/src/platform/shell.ts): call() for commands, on() for events.
(() => {
  const listeners = new Map();

  const shell = {
    call(command, args, bytes) {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const pending =
        bytes !== undefined
          ? invoke(command, bytes, { headers: { "x-rodeo-args": JSON.stringify(args ?? {}) } })
          : invoke(command, { args: args ?? {} });
      return pending.catch((err) => {
        throw new Error(typeof err === "string" ? err : (err && err.message) || String(err));
      });
    },
    on(event, handler) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(handler);
      return () => {
        set.delete(handler);
      };
    },
  };

  // Called by the Rust side through webview.eval(); not part of the page's API.
  Object.defineProperty(shell, "_emit", {
    value(event, payload) {
      const set = listeners.get(event);
      if (!set) return;
      for (const handler of [...set]) {
        try {
          handler(payload);
        } catch (err) {
          console.error(err);
        }
      }
    },
    enumerable: false,
  });

  Object.defineProperty(window, "__rodeoShell", {
    value: shell,
    writable: false,
    enumerable: false,
    configurable: false,
  });
})();
