import * as RSelect from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/utils";

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * shadcn-style Select built on Radix. Fully themed trigger AND dropdown
 * (the native <select> popup could not be themed). Token-driven via styles.css.
 *
 * variant="inline" renders a compact, borderless trigger for toolbars/composers.
 */
export function Select({
  value,
  onValueChange,
  options,
  ariaLabel,
  placeholder,
  disabled,
  variant = "default",
  leadingIcon,
  triggerClassName,
  contentClassName
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  variant?: "default" | "inline";
  leadingIcon?: ReactNode;
  triggerClassName?: string;
  contentClassName?: string;
}) {
  return (
    <RSelect.Root value={value || undefined} onValueChange={onValueChange} disabled={disabled}>
      <RSelect.Trigger
        aria-label={ariaLabel}
        className={cn("rh-select-trigger", variant === "inline" && "rh-select-trigger-inline", triggerClassName)}
      >
        {leadingIcon ? <span className="rh-select-leading">{leadingIcon}</span> : null}
        <RSelect.Value placeholder={placeholder} />
        <RSelect.Icon className="rh-select-icon">
          <ChevronDown size={14} />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content className={cn("rh-select-content", contentClassName)} position="popper" sideOffset={6}>
          <RSelect.Viewport className="rh-select-viewport">
            {options.map((option) => (
              <RSelect.Item key={option.value} value={option.value} className="rh-select-item">
                <RSelect.ItemText>{option.label}</RSelect.ItemText>
                <RSelect.ItemIndicator className="rh-select-indicator">
                  <Check size={14} />
                </RSelect.ItemIndicator>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}
