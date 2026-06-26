"use client";

import { useParams, useSearchParams } from "next/navigation";
import { GuestTrialPage } from "@/components/GuestTrialGate";

/**
 * Guest trial page — accessible without login.
 *
 * Supports two URL forms:
 *   /try           – open trial (no invite code required when REMI_GUEST_INVITE_CODES is empty)
 *   /try/demo      – invite-code in path
 *   /try?code=demo – invite-code in query string
 */
export default function TryPage() {
  const params = useParams();
  const searchParams = useSearchParams();

  // Path: /try/[code] → params.code = ["demo"]
  const codeFromPath = Array.isArray(params?.code)
    ? (params.code[0] ?? "")
    : (params?.code ?? "");

  const inviteCode = codeFromPath || searchParams?.get("code") || "";

  return <GuestTrialPage inviteCode={inviteCode} />;
}
