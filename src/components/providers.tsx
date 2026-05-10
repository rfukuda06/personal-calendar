"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // 30-min staleTime: with surgical cache updates on mutations
          // (see src/lib/eventCache.ts), the cache stays in sync with the
          // server without polling. A long staleTime keeps prefetched
          // ranges from refetching on remount when the user navigates back.
          queries: { staleTime: 30 * 60_000, refetchOnWindowFocus: false },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
