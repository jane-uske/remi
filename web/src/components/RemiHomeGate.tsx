"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useRemiWebAuth } from "@/components/RemiAuthProvider";
import { RemiChatApp } from "@/components/RemiChatApp";

export function RemiHomeGate() {
  const router = useRouter();
  const auth = useRemiWebAuth();

  useEffect(() => {
    if (!auth.clerkEnabled) return;
    if (!auth.ready) return;
    if (!auth.signedIn) {
      router.replace("/sign-in");
    }
  }, [auth.clerkEnabled, auth.ready, auth.signedIn, router]);

  if (auth.clerkEnabled && !auth.ready) {
    return null;
  }

  if (auth.clerkEnabled && !auth.signedIn) {
    return null;
  }

  return <RemiChatApp />;
}
