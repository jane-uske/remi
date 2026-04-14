import type {
  AvatarCommand,
  AvatarFrame,
  AvatarPhase,
  Emotion,
  RemiServerMessage,
} from "../../../avatar/types";

export type MessageRole = "user" | "rem" | "partial" | "error" | "sys";

export type ChatMessage = {
  id: string;
  role: MessageRole;
  text: string;
  createdAt?: string;
};

export type RemiChatEmotion = Emotion;
export type RemiAvatarCommand = AvatarCommand;
export type RemiAvatarFrame = AvatarFrame;
export type RemiAvatarPhase = AvatarPhase;
export type RemiServerWsMessage = RemiServerMessage;
