"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";

export interface AdminRowCommand {
  kind: "command";
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  hidden?: boolean;
  destructive?: boolean;
}

export interface AdminRowLink {
  kind: "link";
  id: string;
  label: string;
  href: string;
  hidden?: boolean;
}

export interface AdminRowMenu {
  kind: "menu";
  id: string;
  label: string;
  value: string;
  choices: Array<{ value: string; label: string; disabled?: boolean }>;
  onSelect: (value: string) => void;
  disabled?: boolean;
  hidden?: boolean;
}

export interface AdminRowSeparator {
  kind: "separator";
  id: string;
  hidden?: boolean;
}

export type AdminRowAction =
  | AdminRowCommand
  | AdminRowLink
  | AdminRowMenu
  | AdminRowSeparator;

export function compactAdminRowActions(
  actions: Array<AdminRowAction | null | undefined | false>,
): AdminRowAction[] {
  return actions.filter((action): action is AdminRowAction => Boolean(action));
}

interface AdminRowActionsProps {
  label: string;
  actions: AdminRowAction[];
  pendingLabel?: string;
}

function isDestructiveCommand(action: AdminRowAction): action is AdminRowCommand {
  return action.kind === "command" && Boolean(action.destructive);
}

export function AdminRowActions({
  label,
  actions,
  pendingLabel,
}: AdminRowActionsProps) {
  const visible = actions.filter((action) => !action.hidden);
  const routine = visible.filter((action) => !isDestructiveCommand(action));
  const destructive = visible.filter(isDestructiveCommand);
  const routineWithoutEdgeSeparators = trimSeparators(routine);

  if (routineWithoutEdgeSeparators.length === 0 && destructive.length === 0) {
    return null;
  }

  const pending = Boolean(pendingLabel);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        aria-label={pendingLabel ? `${label}. ${pendingLabel}` : label}
        aria-busy={pending}
        disabled={pending}
        className={cn(
          "inline-flex h-8 w-[7.5rem] items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-text-secondary",
          "hover:border-border-focus hover:bg-surface-elevated hover:text-text-primary",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <span className="truncate">{pendingLabel ?? "Actions"}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" collisionPadding={12} className="min-w-52">
        {routineWithoutEdgeSeparators.map((action) => renderAction(action, pending))}
        {destructive.length > 0 && routineWithoutEdgeSeparators.length > 0 ? (
          <DropdownMenuSeparator />
        ) : null}
        {destructive.map((action) => renderAction(action, pending))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function trimSeparators(actions: AdminRowAction[]) {
  const next = [...actions];
  while (next[0]?.kind === "separator") next.shift();
  while (next.at(-1)?.kind === "separator") next.pop();
  return next.filter((action, index, all) => {
    if (action.kind !== "separator") return true;
    const previous = all[index - 1];
    return previous ? previous.kind !== "separator" : false;
  });
}

function renderAction(action: AdminRowAction, pending: boolean) {
  if (action.kind === "separator") {
    return <DropdownMenuSeparator key={action.id} />;
  }

  if (action.kind === "link") {
    return (
      <DropdownMenuItem key={action.id} asChild disabled={pending}>
        <Link href={action.href}>{action.label}</Link>
      </DropdownMenuItem>
    );
  }

  if (action.kind === "menu") {
    if (action.disabled) {
      return (
        <DropdownMenuItem key={action.id} disabled>
          {action.label}
        </DropdownMenuItem>
      );
    }

    return (
      <DropdownMenuSub key={action.id}>
        <DropdownMenuSubTrigger disabled={pending}>{action.label}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent collisionPadding={12}>
          <DropdownMenuRadioGroup value={action.value} onValueChange={action.onSelect}>
            {action.choices.map((choice) => (
              <DropdownMenuRadioItem
                key={choice.value}
                value={choice.value}
                disabled={pending || choice.disabled}
              >
                {choice.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  }

  return (
    <DropdownMenuItem
      key={action.id}
      disabled={pending || action.disabled}
      className={action.destructive ? "text-neon-red-400 focus:text-neon-red-400" : undefined}
      onSelect={action.onSelect}
    >
      {action.label}
    </DropdownMenuItem>
  );
}
