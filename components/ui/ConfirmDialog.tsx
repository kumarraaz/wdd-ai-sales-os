"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" styles the confirm button red and focuses Cancel first. */
  tone?: "danger" | "default";
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Used outside a <ConfirmProvider> so the call sites never silently skip confirmation. */
const nativeFallback: ConfirmFn = (o) =>
  Promise.resolve(
    typeof window !== "undefined" &&
      window.confirm(typeof o.description === "string" ? `${o.title}\n\n${o.description}` : o.title),
  );

/**
 * Promise-based confirmation for destructive actions:
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: "Delete 3 leads?", tone: "danger" }))) return;
 */
export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext) ?? nativeFallback;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [open, setOpen] = useState(false);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    const r = resolver.current;
    resolver.current = null; // idempotent: Dialog.onClose also fires after a programmatic close
    setOpen(false);
    r?.(value);
  }, []);

  const confirm = useCallback<ConfirmFn>((o) => {
    resolver.current?.(false); // a newer request supersedes an unanswered one
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setOptions(o);
      setOpen(true);
    });
  }, []);

  const value = useMemo(() => confirm, [confirm]);
  const danger = options?.tone === "danger";

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Dialog
        open={open}
        onClose={() => settle(false)}
        title={options?.title ?? ""}
        description={options?.description}
        size="sm"
        footer={
          <>
            <Button variant="ghost" data-autofocus onClick={() => settle(false)}>
              {options?.cancelLabel ?? "Cancel"}
            </Button>
            <Button variant={danger ? "danger" : "primary"} onClick={() => settle(true)}>
              {options?.confirmLabel ?? "Confirm"}
            </Button>
          </>
        }
      />
    </ConfirmContext.Provider>
  );
}
