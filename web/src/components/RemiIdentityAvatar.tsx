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
      className={`overflow-hidden rounded-full border border-white/20 bg-[linear-gradient(180deg,rgba(232,252,255,0.98),rgba(201,242,247,0.72))] shadow-[0_12px_26px_rgba(4,33,41,0.14)] ${className}`.trim()}
    >
      <img
        src="/avatar/assets/remi-selected-portrait.png"
        alt={alt}
        className="h-full w-full object-cover"
        draggable={false}
      />
    </div>
  );
}
