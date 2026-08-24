import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import { DataProvider } from "./context/DataContext";
import { ThemeProvider } from "./context/ThemeContext";
import { TooltipProvider } from "./context/TooltipContext";
import AmbientBackground from "./components/AmbientBackground";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider>
      <TooltipProvider>
        <DataProvider>
          <AmbientBackground />
          <App />
        </DataProvider>
      </TooltipProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
