import React from "react";
import ReactDOM from "react-dom/client";
import "../styles/desktop.css";
import { ChatPanelApp } from "./ChatPanelApp";

ReactDOM.createRoot(document.getElementById("chat-root")!).render(
  <React.StrictMode>
    <ChatPanelApp />
  </React.StrictMode>,
);
