// `pnpm mobile:check-crypto`: the browser crypto must produce the Rust known-answer frame.
import { KNOWN_FRAME, knownFrame } from "./crypto.ts";

const got = knownFrame();
if (got !== KNOWN_FRAME) throw new Error(`browser crypto differs from Rust: ${got} != ${KNOWN_FRAME}`);
console.log("browser crypto matches the Rust known answer");
