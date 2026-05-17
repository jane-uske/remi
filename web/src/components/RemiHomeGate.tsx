"use client";

import { useRouter } from "next/navigation";

import { useRemiWebAuth } from "@/components/RemiAuthProvider";
import { RemiChatApp } from "@/components/RemiChatApp";
import { RemiLanding } from "@/components/RemiLanding";

export function RemiHomeGate() {
  const router = useRouter();
  const auth = useRemiWebAuth();

  if (auth.clerkEnabled && !auth.ready) {
    return null;
  }

  if (auth.clerkEnabled && !auth.signedIn) {
    return <RemiLanding onEnter={() => router.push("/sign-in")} />;
  }

  return <RemiChatApp />;
}
