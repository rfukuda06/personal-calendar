// Server component: prefetch the events query for [start, end) using the
// same query key the client view uses, then dehydrate into the React tree.
// On the client, <HydrationBoundary> seeds the QueryClient before any
// useQuery runs, so the first paint already has events instead of an
// empty loading state.

import {
  HydrationBoundary,
  QueryClient,
  dehydrate,
} from "@tanstack/react-query";
import type { DateTime } from "luxon";
import { auth } from "@/auth";
import { fetchEventsInRange } from "@/lib/events";

export async function EventsHydration({
  start,
  end,
  children,
}: {
  start: DateTime;
  end: DateTime;
  children: React.ReactNode;
}) {
  const session = await auth();
  const userId = session?.user?.id;
  const queryClient = new QueryClient();
  if (userId) {
    await queryClient.prefetchQuery({
      queryKey: ["events", start.toISO(), end.toISO()],
      queryFn: () =>
        fetchEventsInRange(userId, start.toJSDate(), end.toJSDate()),
    });
  }
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {children}
    </HydrationBoundary>
  );
}
