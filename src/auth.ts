import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";
import { prisma } from "@/lib/db";

// Full NextAuth instance used by route handlers and server components.
// Extends the edge-safe config with callbacks that touch Prisma.
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    async signIn({ user, profile }) {
      if (!profile?.sub || !user.email) return false;
      await prisma.user.upsert({
        where: { googleId: profile.sub },
        create: {
          googleId: profile.sub,
          email: user.email,
          name: user.name ?? null,
          image: user.image ?? null,
        },
        update: {
          email: user.email,
          name: user.name ?? null,
          image: user.image ?? null,
        },
      });
      return true;
    },
    async jwt({ token, profile }) {
      if (profile?.sub) {
        token.googleId = profile.sub;
        const dbUser = await prisma.user.findUnique({
          where: { googleId: profile.sub },
          select: { id: true },
        });
        if (dbUser) token.userId = dbUser.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.googleId) session.user.googleId = token.googleId as string;
      if (token.userId) session.user.id = token.userId as string;
      return session;
    },
  },
});
