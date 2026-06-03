import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import {
  DEFAULT_DEV_USER_ID,
} from "@/hooks/useRemiChatHelpers";

type RemiWebAuthContextValue = {
  clerkEnabled: boolean;
  ready: boolean;
  signedIn: boolean;
  canSignOut: boolean;
  currentUserId: string;
  isDefaultDevUser: boolean;
  getSessionToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
};

const DESKTOP_CONTEXT: RemiWebAuthContextValue = {
  clerkEnabled: false,
  ready: true,
  signedIn: true,
  canSignOut: false,
  currentUserId: DEFAULT_DEV_USER_ID,
  isDefaultDevUser: true,
  getSessionToken: async () => null,
  signOut: async () => {},
};

const RemiWebAuthContext =
  createContext<RemiWebAuthContextValue>(DESKTOP_CONTEXT);

export function RemiAuthProvider({ children }: { children: ReactNode }) {
  const value = useMemo(() => DESKTOP_CONTEXT, []);
  return (
    <RemiWebAuthContext.Provider value={value}>
      {children}
    </RemiWebAuthContext.Provider>
  );
}

export function useRemiWebAuth(): RemiWebAuthContextValue {
  return useContext(RemiWebAuthContext);
}
