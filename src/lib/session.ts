import { auth } from "@/auth";

/**
 * Returns the signed-in user's DB id, or throws. Use in API route handlers
 * (the middleware already gates calendar pages, but /api/* is not matched).
 */
export async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Response("Unauthorized", { status: 401 });
  }
  return session.user.id;
}
