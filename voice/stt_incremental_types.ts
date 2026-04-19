export type StreamingSttProvider = "openai-realtime" | "sherpa-onnx";

export type StreamingTranscriptPartial = {
  content: string;
  itemId: string;
  provider: StreamingSttProvider;
  sequence: number;
  stability: "interim";
};

export type StreamingTranscriptFinal = {
  content: string;
  itemId: string;
  provider: StreamingSttProvider;
  sequence: number;
  stability: "final";
};

export type StreamingTranscriptHandlers = {
  onPartial(event: StreamingTranscriptPartial): void;
  onFinal(event: StreamingTranscriptFinal): void;
  onError(error: Error): void;
};

export type ActiveStreamingSttSession = {
  appendPcm(pcm: Buffer, sampleRate: number): void;
  close(): Promise<void>;
};
