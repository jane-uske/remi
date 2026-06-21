export const remiChatLayoutClasses = {
  appShell:
    "remi-app-shell remi-airi-app relative flex h-dvh w-full flex-col overflow-hidden text-[var(--foreground)]",
  headerShell:
    "pointer-events-none absolute inset-x-0 top-0 z-30 bg-transparent px-3 pb-0 pt-[calc(env(safe-area-inset-top)+1.25rem)] sm:px-5 sm:pt-[calc(env(safe-area-inset-top)+1.5rem)]",
  headerInner:
    "pointer-events-auto relative z-10 mx-auto flex max-w-[118rem] flex-wrap items-start justify-between gap-x-3 gap-y-2 sm:items-center",
  mainShell:
    "relative z-10 flex min-h-0 flex-1 overflow-hidden",
  stageShell:
    "relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-3 pb-24 pt-20 sm:px-4 sm:pb-28 sm:pt-24 md:px-6 md:pb-10 md:pt-20 md:pr-[min(24rem,30vw)] lg:px-10 lg:pb-12 lg:pt-20 lg:pr-[min(26rem,32vw)]",
  mobileControlRail:
    "pointer-events-auto absolute right-2 top-[calc(env(safe-area-inset-top)+5.25rem)] z-25 flex flex-col items-end sm:right-3 md:hidden",
  chatAside:
    "remi-chat-mobile-immersive pointer-events-none absolute inset-x-0 bottom-0 z-20 flex min-h-0 flex-col gap-2 px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[min(28svh,11.5rem)] sm:px-3 md:pointer-events-auto md:left-auto md:right-6 md:top-auto md:w-[min(26rem,32vw)] md:max-w-[26rem] md:px-0 md:pb-0 md:pt-0 lg:right-8",
  chatCard:
    "remi-chat-shell pointer-events-none flex max-h-full min-h-0 w-full flex-col gap-1 overflow-hidden rounded-none border-transparent bg-transparent shadow-none backdrop-blur-0 md:pointer-events-auto md:max-h-[56svh] md:gap-0",
  chatWindowFrame:
    "pointer-events-auto mx-auto flex min-h-0 w-full max-w-[min(100%,34rem)] flex-col md:max-w-none md:flex-1",
  chatComposerDock:
    "shrink-0 border-transparent bg-transparent px-0 py-0 backdrop-blur-0 md:px-3 md:py-3",
  chatComposerFrame:
    "pointer-events-auto mx-auto w-full min-w-0 max-w-[min(100%,34rem)] shrink-0 overflow-visible px-0 md:max-w-none",
} as const;

const nsfwChatLayoutClasses = {
  ...remiChatLayoutClasses,
  mainShell:
    "relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden",
  stageShell: "hidden",
  chatAside:
    "pointer-events-auto relative z-20 flex min-h-0 flex-1 flex-col gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[calc(env(safe-area-inset-top)+5rem)] sm:px-4 md:px-8 md:pt-24",
  chatCard:
    "remi-chat-shell pointer-events-auto flex h-full max-h-none min-h-0 w-full flex-col gap-2 overflow-hidden rounded-none border-transparent bg-transparent shadow-none backdrop-blur-0 md:max-h-full md:gap-0",
  chatWindowFrame:
    "pointer-events-auto mx-auto flex min-h-0 w-full max-w-[min(100%,42rem)] flex-1 flex-col md:max-w-[48rem]",
  chatComposerFrame:
    "pointer-events-auto mx-auto w-full max-w-[min(100%,42rem)] shrink-0 px-0 md:max-w-[48rem]",
} as const;

export type RemiChatLayoutClasses = {
  [K in keyof typeof remiChatLayoutClasses]: string;
};

export function remiChatLayoutForNsfw(nsfw: boolean): RemiChatLayoutClasses {
  return nsfw ? nsfwChatLayoutClasses : remiChatLayoutClasses;
}