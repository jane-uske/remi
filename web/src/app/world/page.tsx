import type { Metadata } from "next";
import { RemiAuthProvider } from "@/components/RemiAuthProvider";
import { BackToChatLink } from "@/components/BackToChatLink";
import RemiWorld from "@/components/RemiWorld";

export const metadata: Metadata = {
  title: "RemiWorld — 一个世界，一段回忆，一份陪伴",
  description:
    "Remi 的小小世界 v0.1：黄昏小岛上的房间、阳台、庭院与记忆墙。",
};

export default function WorldPage() {
  // 与 / 同一套鉴权上下文：世界里的对话走同一个 Remi（同身份/记忆/人格）
  return (
    <RemiAuthProvider>
      <BackToChatLink />
      <RemiWorld />
    </RemiAuthProvider>
  );
}
