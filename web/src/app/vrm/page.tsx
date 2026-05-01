import { RemiAuthProvider } from "@/components/RemiAuthProvider";
import { RemiVrmLab } from "@/components/RemiVrmLab";

export const metadata = {
  title: "Remi VRM Lab",
  description: "真实链路 VRM 验证页",
};

export default function VrmPage() {
  return (
    <RemiAuthProvider>
      <RemiVrmLab />
    </RemiAuthProvider>
  );
}
