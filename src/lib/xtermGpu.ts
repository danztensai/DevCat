// Draw a terminal with WebGL (on the GPU): much smoother scrolling and output than xterm's
// default DOM renderer. Falls back to the DOM renderer when WebGL isn't available or the browser
// takes the context back (too many terminals open, GPU reset).
import { WebglAddon } from "@xterm/addon-webgl";
import type { Terminal } from "@xterm/xterm";

/** Call after `term.open()`. */
export function enableGpu(term: Terminal) {
  try {
    const gl = new WebglAddon();
    gl.onContextLoss(() => gl.dispose());
    term.loadAddon(gl);
  } catch {
    /* no WebGL: the DOM renderer stays */
  }
}
