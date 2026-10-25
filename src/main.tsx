import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { OpsDashboard } from "./ops/OpsDashboard";
import { TripsSite } from "./trips/TripsSite";
import "./index.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);
const TRIPS_ONLY = import.meta.env.VITE_TRIPS_ONLY === "1";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Routes>
          {/* The hosted build (VITE_TRIPS_ONLY) is the rider site only; the ops dashboard stays local. */}
          {!TRIPS_ONLY && <Route path="/ops" element={<OpsDashboard />} />}
          <Route path="/trips" element={<TripsSite />} />
          <Route path="*" element={<Navigate to={TRIPS_ONLY ? "/trips" : "/ops"} replace />} />
        </Routes>
      </BrowserRouter>
    </ConvexProvider>
  </StrictMode>,
);
