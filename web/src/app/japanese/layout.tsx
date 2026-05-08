import type { Metadata } from "next";
import "./tokens.css";

export const metadata: Metadata = {
  title: "Remi Japanese Mode — N5→N1 陪伴式日语成长系统",
  description: "Remi 日语学习 Dashboard",
};

export default function JapaneseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="jp-scope min-h-dvh">{children}</div>;
}
