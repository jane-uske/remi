import { RemiAuthProvider } from "@/components/RemiAuthProvider";
import { RemiHomeGate } from "@/components/RemiHomeGate";

export default function Home() {
  return (
    <RemiAuthProvider>
      <RemiHomeGate />
    </RemiAuthProvider>
  );
}
