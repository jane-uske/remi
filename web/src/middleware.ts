import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * 误将 `localhost:3000/...` 写成无前缀的相对路径时，浏览器会解析为
 * `/localhost:3000/...`，并可能层层嵌套。收到此类路径时统一回到首页。
 */
export function middleware(request: NextRequest) {
  const p = request.nextUrl.pathname;
  if (/\/localhost:\d+/.test(p) || /\/127\.0\.0\.1:\d+/.test(p)) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|japanese|api/japanese).*)",
  ],
};
