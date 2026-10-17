import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "./lib/monaco";

// `vite --mode demo`: lets promo/capture.mjs open screens directly (not in real builds).
if (import.meta.env.MODE === "demo") void import("./dev/demoHooks");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
