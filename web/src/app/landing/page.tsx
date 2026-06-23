"use client";

import { useRouter } from "next/navigation";
import { RemiLanding } from "@/components/RemiLanding";

export default function LandingPreviewPage() {
  const router = useRouter();
  return <RemiLanding onEnter={() => router.push("/sign-in")} />;
}
