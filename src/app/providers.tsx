"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode, useEffect, useState } from "react";
import { useAuthStore } from "@/stores/auth";
import { usePatientQueueStore } from "@/stores/patient-queue";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  const [storesHydrated, setStoresHydrated] = useState(false);

  useEffect(() => {
    void Promise.all([
      useAuthStore.persist.rehydrate(),
      usePatientQueueStore.persist.rehydrate(),
    ]).finally(() => setStoresHydrated(true));
  }, []);

  if (!storesHydrated) {
    return (
      <QueryClientProvider client={queryClient}>
        <div className="min-h-screen bg-zinc-50" aria-busy="true" />
      </QueryClientProvider>
    );
  }

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

