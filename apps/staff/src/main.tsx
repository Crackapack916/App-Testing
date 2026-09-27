import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import { App } from "./App";
import "./styles.css";

// Clerk when configured; the pilot sign in otherwise (test mode only).
const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

createRoot(document.getElementById("root")!).render(
  clerkKey ? <ClerkProvider publishableKey={clerkKey}><App clerk /></ClerkProvider> : <App />,
);
