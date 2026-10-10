import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/bebas-neue";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./styles.css";
import App from "./App";
import { SharedView } from "./SharedView";

const shareId = /^\/s\/([A-Za-z0-9]{8})\/?$/.exec(window.location.pathname)?.[1];

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{shareId ? <SharedView id={shareId} /> : <App />}</React.StrictMode>
);
