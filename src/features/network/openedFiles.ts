// .ovpn files opened with DevCat (double-click in Finder / Explorer, "Open With", or dropped on
// the Dock icon): the backend queues them and pokes the main window, which opens the import form.
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IS_MAIN_WINDOW } from "../../lib/windows";
import { useUi } from "../../store/ui";
import { openImportTab } from "./actions";

async function drain() {
  const paths = await invoke<string[]>("take_opened_files").catch(() => [] as string[]);
  if (!paths.length) return;
  const ui = useUi.getState();
  ui.setSidebar("network");
  ui.setSidebarCollapsed(false);
  paths.forEach(openImportTab);
  const w = getCurrentWindow();
  await w.unminimize().catch(() => {});
  await w.setFocus().catch(() => {});
}

// Any window may take them (each file is handed out once); at launch the main window does.
void listen("opened-files", () => void drain()).catch(() => {});
if (IS_MAIN_WINDOW) void drain();
