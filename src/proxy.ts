import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Next 16 renamed `middleware` → `proxy`. Runs on the nodejs runtime.
// Uses authConfig only; auth.ts adds the DB callbacks for route handlers.
const { auth } = NextAuth(authConfig);
export const proxy = auth;

export const config = {
  matcher: ["/calendar/:path*"],
};
