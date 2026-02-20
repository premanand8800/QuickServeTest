"use client";

import { SessionProvider } from "next-auth/react";
import QueryProvider from "@/components/providers/QueryProvider";
import ClientRuntimeGuard from "@/components/providers/ClientRuntimeGuard";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <QueryProvider>
        <ClientRuntimeGuard />
        {children}
      </QueryProvider>
    </SessionProvider>
  );
}
