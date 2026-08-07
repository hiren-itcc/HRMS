'use client';

import { Button, type ButtonProps } from '@hrms/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@hrms/ui/components/tooltip';
import type { LucideIcon } from 'lucide-react';

interface IconActionProps {
  /** Says what the button does — on hover, and to a screen reader. */
  label: string;
  icon: LucideIcon;
  onClick?: () => void;
  /** For an action that is really a link: `render={<Link href="…" />}`. */
  render?: ButtonProps['render'];
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  className?: string;
  /** For the odd icon that is not 16px — the header's chevrons are 18. */
  iconClassName?: string;
  disabled?: boolean;
  /** Disclosure buttons: an org-chart node, a collapsible sidebar. */
  expanded?: boolean;
}

/**
 * An icon-only button that says what it is.
 *
 * A pencil and a bin are only obvious to somebody who already knows the app.
 * One label serves both readings of the button — `aria-label` for a screen
 * reader and a tooltip for everybody else — so the two cannot drift apart the
 * way they do when the tooltip is bolted on separately.
 *
 * The provider lives in `providers.tsx`, so nothing has to be wrapped locally.
 */
export function IconAction({
  label,
  icon: Icon,
  onClick,
  render,
  variant = 'ghost',
  size = 'icon',
  className,
  iconClassName = 'size-4',
  disabled,
  expanded,
}: IconActionProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={variant}
            size={size}
            className={className}
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            aria-expanded={expanded}
            render={render}
          />
        }
      >
        <Icon className={iconClassName} aria-hidden />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
