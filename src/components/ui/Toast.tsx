import type { ReactNode } from "react";
import { Toaster as SonnerToaster, toast as sonnerToast } from "sonner";

export interface ToastContextValue {
  toast: (
    message: string,
    tone?: "success" | "error" | "info" | "warning",
  ) => void;
}

export function useToast(): ToastContextValue {
  return {
    toast: (message, tone = "success") => {
      if (tone === "error") sonnerToast.error(message);
      else if (tone === "info") sonnerToast.info(message);
      else if (tone === "warning") sonnerToast.warning(message);
      else sonnerToast.success(message);
    },
  };
}

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <SonnerToaster
        richColors
        position="top-center"
        toastOptions={{ duration: 3800 }}
      />
    </>
  );
}