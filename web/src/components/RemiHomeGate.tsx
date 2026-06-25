"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useRemiWebAuth } from "@/components/RemiAuthProvider";
import { RemiLanding } from "@/components/RemiLanding";

/**
 * `/` — smart entry. Signed-in users are sent to the dedicated `/chat` route;
 * signed-out users see the public portal (landing). The redirect runs in an
 * effect (never during render) and is gated on `ready` so a Clerk
 * loading/flicker can't bounce the user. Pairs with {@link RemiChatGate} at
 * `/chat`, which redirects the opposite direction — together they can't loop
 * because each only redirects in its own auth state.
 */
export function RemiHomeGate() {
  const router = useRouter();
  const auth = useRemiWebAuth();
  const ready = !auth.clerkEnabled || auth.ready;
  const signedIn = auth.signedIn;

  useEffect(() => {
    if (ready && signedIn) router.replace("/chat");
  }, [ready, signedIn, router]);

  if (!ready) return null;
  if (signedIn) return null; // redirecting to /chat
  return <RemiLanding onEnter={() => router.push("/sign-in")} />;
}
