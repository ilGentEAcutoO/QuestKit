import { lazy, type ReactElement, Suspense } from "react";
import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
} from "react-router-dom";

import { DemoToastProvider } from "./components/DemoToastHost";
import { Layout } from "./components/Layout";
import { RouteFallback } from "./components/RouteFallback";
import { DemoClientProvider } from "./lib/client";
// Ecommerce is the default route (both `/` and `*` Navigate here). Eager-
// loading it avoids a second network round-trip and lets the LCP element
// paint within the initial chunk fetch — Lighthouse mobile gates this.
import { EcommerceRoute } from "./routes/ecommerce";

// Lazy-load the secondary routes. framer-motion-heavy routes (daily,
// minigames, streaming) stay in their own per-route chunks. Vite produces
// one chunk per dynamic import.
const StreamingRoute = lazy(() =>
  import("./routes/streaming").then((m) => ({ default: m.StreamingRoute })),
);
const DailyRoute = lazy(() =>
  import("./routes/daily").then((m) => ({ default: m.DailyRoute })),
);
const MiniGamesRoute = lazy(() =>
  import("./routes/minigames").then((m) => ({ default: m.MiniGamesRoute })),
);

function withSuspense(node: ReactElement): ReactElement {
  return <Suspense fallback={<RouteFallback />}>{node}</Suspense>;
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/ecommerce" replace /> },
      { path: "ecommerce", element: <EcommerceRoute /> },
      { path: "streaming", element: withSuspense(<StreamingRoute />) },
      { path: "daily", element: withSuspense(<DailyRoute />) },
      { path: "minigames", element: withSuspense(<MiniGamesRoute />) },
      { path: "*", element: <Navigate to="/ecommerce" replace /> },
    ],
  },
]);

export function App(): ReactElement {
  return (
    <DemoClientProvider>
      <DemoToastProvider>
        <RouterProvider router={router} />
      </DemoToastProvider>
    </DemoClientProvider>
  );
}
