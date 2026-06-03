import React from "react";
import ReactDOM from "react-dom/client";
import "../styles/desktop.css";
import { CharacterApp } from "./CharacterApp";

ReactDOM.createRoot(document.getElementById("character-root")!).render(
  <React.StrictMode>
    <CharacterApp />
  </React.StrictMode>,
);
