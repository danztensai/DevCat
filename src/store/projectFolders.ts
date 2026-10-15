// Each focused project remembers its own folders (AI Workspace folder, Git scan folder);
// without focus the global ones are used. Follows this window's project focus.
import { useWorkspace } from "../features/claude/sidebar/workspace";
import { useGitScan } from "../features/git/scan";
import { useConnections } from "./connections";

function apply(projectId: string | null) {
  useWorkspace.getState().setProject(projectId);
  useGitScan.getState().setProject(projectId);
}

apply(useConnections.getState().focusProjectId);
useConnections.subscribe((s, prev) => {
  if (s.focusProjectId !== prev.focusProjectId) apply(s.focusProjectId);
});
