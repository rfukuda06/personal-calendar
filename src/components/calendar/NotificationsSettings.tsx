"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

type Me = {
  id: string;
  email: string;
  notificationsEnabled: boolean;
};

export function NotificationsSettings() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<Me>("/api/me"),
  });

  const toggle = useMutation({
    mutationFn: (next: boolean) =>
      api.patch<Me>("/api/me", { notificationsEnabled: next }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });

  if (isLoading || !data) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={data.notificationsEnabled}
            onChange={(e) => toggle.mutate(e.target.checked)}
            className="mt-1"
          />
          <div>
            <div className="text-sm font-medium">Email reminders</div>
            <p className="text-xs text-muted-foreground">
              Send reminder emails to <strong>{data.email}</strong> before
              events, big events, and due dates, plus a 12:00 PM daily todo
              digest. Turn off to pause every reminder without removing them
              from your events.
            </p>
          </div>
        </label>
      </div>
    </div>
  );
}
