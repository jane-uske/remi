"use client";

import { SignIn } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { RemiAuthProvider, useRemiWebAuth } from "@/components/RemiAuthProvider";
import { isClerkWebAuthEnabled } from "@/lib/authMode";

function SignInPageInner() {
  const router = useRouter();
  const auth = useRemiWebAuth();

  useEffect(() => {
    if (!isClerkWebAuthEnabled()) {
      router.replace("/");
      return;
    }
    if (auth.ready && auth.signedIn) {
      router.replace("/");
    }
  }, [auth.ready, auth.signedIn, router]);

  if (!isClerkWebAuthEnabled()) {
    return null;
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <SignIn
        path="/sign-in"
        routing="path"
        signUpForceRedirectUrl="/"
        forceRedirectUrl="/"
      />
    </main>
  );
}

export default function SignInPage() {
  return (
    <RemiAuthProvider>
      <SignInPageInner />
    </RemiAuthProvider>
  );
}
