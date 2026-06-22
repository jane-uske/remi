"use client";

type RemiIdentityAvatarProps = {
  className?: string;
  alt?: string;
};

export function RemiIdentityAvatar({
  className = "",
  alt = "Remi avatar",
}: RemiIdentityAvatarProps) {
  return (
    <div
      className={`overflow-hidden rounded-full border border-white/20 bg-[linear-gradient(180deg,rgba(243,232,255,0.98),rgba(221,214,254,0.72))] shadow-[0_12px_26px_rgba(76,29,149,0.18)] ${className}`.trim()}
    >
      <img
        src="/assets/remi/avatar/remi-avatar-main.png"
        alt={alt}
        className="h-full w-full object-cover"
        draggable={false}
      />
    </div>
  );
}
