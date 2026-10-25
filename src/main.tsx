import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { OpsDashboard } from "./ops/OpsDashboard";
import { TripsSite } from "./trips/TripsSite";
import "./index.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <BrowserRouter>
        <Routes>
          <Route path="/ops" element={<OpsDashboard />} />
          <Route path="/trips" element={<TripsSite />} />
          <Route path="*" element={<Navigate to="/ops" replace />} />
        </Routes>
      </BrowserRouter>
    </ConvexProvider>
  </StrictMode>,
);
