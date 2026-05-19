import type { ReactElement } from "react";
import { RewardClaimToastHost } from "@questkit/react";
import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
} from "react-router-dom";

import { Layout } from "./components/Layout";
import { DemoClientProvider } from "./lib/client";
import { DailyRoute } from "./routes/daily";
import { EcommerceRoute } from "./routes/ecommerce";
import { MiniGamesRoute } from "./routes/minigames";
import { StreamingRoute } from "./routes/streaming";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/ecommerce" replace /> },
      { path: "ecommerce", element: <EcommerceRoute /> },
      { path: "streaming", element: <StreamingRoute /> },
      { path: "daily", element: <DailyRoute /> },
      { path: "minigames", element: <MiniGamesRoute /> },
      { path: "*", element: <Navigate to="/ecommerce" replace /> },
    ],
  },
]);

export function App(): ReactElement {
  return (
    <DemoClientProvider>
      <RouterProvider router={router} />
      <RewardClaimToastHost />
    </DemoClientProvider>
  );
}
