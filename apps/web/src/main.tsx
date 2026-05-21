import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";

import { AuthProvider } from "@/auth/auth-provider";
import { App } from "@/app";
import { ToastProvider } from "@/components/ui/toast";
import { LangProvider } from "@/lib/lang";

import "./index.css";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <LangProvider>
          <ToastProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </ToastProvider>
        </LangProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
