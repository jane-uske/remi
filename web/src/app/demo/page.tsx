import Link from "next/link";
import { Remi3DDemo } from "@/components/Remi3DDemo";

export const metadata = {
  title: "Remi 3D Demo",
  description: "3D 验收与实验壳，不是默认聊天入口",
};

export default function DemoPage() {
  return (
    <main className="relative min-h-dvh">
      <div className="pointer-events-none absolute left-4 top-4 z-20 flex flex-wrap items-center gap-2">
        <Link
          href="/"
          className="pointer-events-auto inline-flex items-center rounded-full border border-white/10 bg-black/40 px-4 py-2 text-sm text-[var(--foreground)] backdrop-blur-md transition hover:border-[var(--remi-accent)] hover:bg-black/55"
        >
          返回聊天页
        </Link>
        <span className="inline-flex items-center rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-xs text-sky-100 backdrop-blur-md">
          3D 验收 / 实验模式
        </span>
      </div>
      <Remi3DDemo />
    </main>
  );
}
