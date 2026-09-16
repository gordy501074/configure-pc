import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { Skeleton } from "./components/ui";
import { RequireAuth, RequireCustomer, RequireRole } from "./screens/guards";

const Layout = lazy(() => import("./screens/Layout"));
const Onboarding = lazy(() => import("./screens/Onboarding"));
const Auth = lazy(() => import("./screens/Auth"));
const Home = lazy(() => import("./screens/Home"));
const ReadyPCs = lazy(() => import("./screens/ReadyPCs"));
const PcCard = lazy(() => import("./screens/PcCard"));
const CustomConfig = lazy(() => import("./screens/CustomConfig"));
const AutoSelect = lazy(() => import("./screens/AutoSelect"));
const AutoResult = lazy(() => import("./screens/AutoResult"));
const Profile = lazy(() => import("./screens/Profile"));
const Checkout = lazy(() => import("./screens/Checkout"));
const InstallmentCheckout = lazy(() => import("./screens/InstallmentCheckout"));
const Admin = lazy(() => import("./screens/Admin"));
const NotFound = lazy(() => import("./screens/NotFound"));

function fallback(): ReactNode {
  return (
    <div className="container" style={{ paddingBlock: "var(--space-7)" }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} style={{ marginBottom: "var(--space-4)" }}>
          <Skeleton className="h-20 w-full" />
        </div>
      ))}
    </div>
  );
}

function RouteFallback({ children }: { children: ReactNode }) {
  return <Suspense fallback={fallback()}>{children}</Suspense>;
}

function AppLayout() {
  return (
    <RouteFallback>
      <Layout />
    </RouteFallback>
  );
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <Home /> },
      { path: "onboarding", element: <Onboarding /> },
      { path: "auth", element: <Auth /> },
      { path: "ready", element: <ReadyPCs /> },
      { path: "ready/:id", element: <PcCard /> },
      { path: "config", element: <CustomConfig /> },
      { path: "auto", element: <AutoSelect /> },
      { path: "auto/result", element: <AutoResult /> },
      {
        path: "profile",
        element: (
          <RequireAuth>
            <Profile />
          </RequireAuth>
        ),
      },
      {
        path: "profile/:tab",
        element: (
          <RequireAuth>
            <Profile />
          </RequireAuth>
        ),
      },
      {
        path: "checkout",
        element: (
          <RequireCustomer>
            <Checkout />
          </RequireCustomer>
        ),
      },
      {
        path: "alpha",
        element: (
          <RequireCustomer>
            <InstallmentCheckout />
          </RequireCustomer>
        ),
      },
      {
        path: "admin",
        element: (
          <RequireRole role="admin">
            <Admin />
          </RequireRole>
        ),
      },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}