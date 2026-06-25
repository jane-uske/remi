import { RemiAuthProvider } from "@/components/RemiAuthProvider";
import { RemiChatGate } from "@/components/RemiChatGate";

export default function ChatPage() {
  return (
    <RemiAuthProvider>
      <RemiChatGate />
    </RemiAuthProvider>
  );
}
