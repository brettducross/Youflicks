import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE_HINTS = ["better-auth.session_token", "__Secure-better-auth.session_token"];

function hasSessionCookie(request: NextRequest) {
  return SESSION_COOKIE_HINTS.some((name) => request.cookies.has(name));
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const signedIn = hasSessionCookie(request);

  if (pathname.startsWith("/dashboard") || pathname.startsWith("/projects")) {
    if (!signedIn) {
      const url = request.nextUrl.clone();
      url.pathname = "/sign-in";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }

  if ((pathname === "/sign-in" || pathname === "/sign-up") && signedIn) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/projects/:path*", "/sign-in", "/sign-up"],
};
