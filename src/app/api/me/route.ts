import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";

// User-level preferences live under /api/me. Today this is just the
// notifications toggle; other per-user knobs (default category color,
// default view, etc.) can pile on here without a new route.

export async function GET() {
  const userId = await requireUserId();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      notificationsEnabled: true,
    },
  });
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(user);
}

const patchSchema = z.object({
  notificationsEnabled: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  const userId = await requireUserId();
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const updated = await prisma.user.update({
    where: { id: userId },
    data: parsed.data,
    select: { id: true, notificationsEnabled: true },
  });
  return NextResponse.json(updated);
}
