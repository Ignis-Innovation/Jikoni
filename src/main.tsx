import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Careers from "./views/Careers";
import "./index.css";

// The public careers page lives outside the authenticated app shell — no login,
// no AppProvider. Every other path renders the gated Operations Suite.
const isCareers = window.location.pathname.startsWith("/careers");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isCareers ? <Careers /> : <App />}
  </React.StrictMode>
);
