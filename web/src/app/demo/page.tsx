import Link from "next/link";
import { Rem3DDemo } from "@/components/Rem3DDemo";

export const metadata = {
  title: "Rem 3D Demo",
  description: "无后端 3D 验收与控制台",
};

export default function DemoPage() {
  return (
    <main className="relative min-h-dvh">
      <div className="pointer-events-none absolute left-4 top-4 z-20">
        <Link
          href="/"
          className="pointer-events-auto inline-flex items-center rounded-full border border-white/10 bg-black/40 px-4 py-2 text-sm text-[var(--foreground)] backdrop-blur-md transition hover:border-[var(--remi-accent)] hover:bg-black/55"
        >
          返回聊天页
        </Link>
      </div>
      <Rem3DDemo />
    </main>
  );
}
