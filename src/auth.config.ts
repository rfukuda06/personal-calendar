import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

// Edge-safe portion of the NextAuth config. No Prisma, no Node-only imports.
// Consumed by middleware (Edge runtime) AND by the full auth.ts which extends
// it with DB-touching callbacks.
export const authConfig = {
  providers: [Google],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/signin",
  },
  callbacks: {
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const onCalendar = request.nextUrl.pathname.startsWith("/calendar");
      if (onCalendar) return isLoggedIn; // false → redirect to signIn page
      return true;
    },
  },
} satisfies NextAuthConfig;
