// error reports first, so an error while the rest starts up is reported too
import "./app/reports.ts";
import "./app/visits.ts";
import "./features/index.ts";
import { App } from "./app/app.ts";
import { appContext } from "./app/ext.ts";
import { startLanguage } from "./app/i18n.ts";
import { store } from "./app/state.ts";
import { prefs, setPrefs } from "./app/prefs.ts";
import { installShellLinks } from "./app/shellLinks.ts";
import { renderStatus } from "./features/render/bridge.ts";
import { patchRender, renderSettings } from "./features/render/settings.ts";
import { inShell } from "./platform/shell.ts";

// the desktop app: links and window.open leave for the system's browser, and the window stays on the editor
if (inShell()) installShellLinks();

// the interface's language first, so the editor isn't seen in English before it
void startLanguage().then(() => {
  new App().start();
  // The desktop app's test bridge and the measuring scripts drive the editor through this; nothing
  // sets __rodeoTest in a normal run.
  if ((globalThis as { __rodeoTest?: boolean }).__rodeoTest === true) {
    (globalThis as { __rodeoApp?: unknown }).__rodeoApp = {
      appContext,
      store,
      render: { status: renderStatus, settings: renderSettings, patch: patchRender },
      prefs,
      setPrefs,
      /** Runs a Python script as Run Script does, and gives back what it printed. */
      python: async (code: string) => {
        const { runScript } = await import("./features/python/runner.ts");
        const out: string[] = [];
        const done = await runScript(code, "test.py", { print: (kind, text) => out.push(`${kind}: ${text}`) });
        return { out, error: done.error, steps: done.steps };
      },
    };
  }
});
