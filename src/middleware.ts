import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Edge-runtime-safe: only uses authConfig, which has no Prisma/Node imports.
// The route-handler-side auth.ts adds the DB callbacks; middleware doesn't need them.
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  matcher: ["/calendar/:path*"],
};
