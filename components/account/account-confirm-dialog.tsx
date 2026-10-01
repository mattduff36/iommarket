"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface AccountConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
}

export function AccountConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pendingLabel = "Working…",
  cancelLabel = "Cancel",
  destructive = false,
  pending = false,
  onConfirm,
}: AccountConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? "energy" : "trust"}
            onClick={onConfirm}
            loading={pending}
            aria-busy={pending || undefined}
          >
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
