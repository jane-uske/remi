"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useRemiWebAuth } from "@/components/RemiAuthProvider";
import { RemiChatApp } from "@/components/RemiChatApp";

/**
 * `/chat` — the chat surface. Requires auth: signed-out users are sent back to
 * `/` (the portal). Mirror of {@link RemiHomeGate}; the two never loop because
 * each redirects only in its own auth state and both wait for `ready`.
 */
export function RemiChatGate() {
  const router = useRouter();
  const auth = useRemiWebAuth();
  const ready = !auth.clerkEnabled || auth.ready;
  const signedIn = auth.signedIn;

  useEffect(() => {
    if (ready && !signedIn) router.replace("/");
  }, [ready, signedIn, router]);

  if (!ready) return null;
  if (!signedIn) return null; // redirecting to /
  return <RemiChatApp />;
}
