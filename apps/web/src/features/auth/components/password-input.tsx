'use client';

import { Button } from '@hrms/ui/components/button';
import { Input } from '@hrms/ui/components/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@hrms/ui/components/tooltip';
import { Eye, EyeOff } from 'lucide-react';
import { forwardRef, useState } from 'react';

/** Password input with show/hide toggle (44px hit target, aria-labelled). */
export const PasswordInput = forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  function PasswordInput(props, ref) {
    const [visible, setVisible] = useState(false);
    return (
      <div className="relative">
        <Input ref={ref} type={visible ? 'text' : 'password'} className="pr-11" {...props} />
        {/*
          Not an IconAction: this one is deliberately out of the tab order, so
          tabbing from the password field reaches the submit button rather than
          a decoration. Wrapped by hand to keep that.
        */}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute top-0 right-0 h-full w-11 text-muted-foreground hover:bg-transparent"
                aria-label={visible ? 'Hide password' : 'Show password'}
                onClick={() => setVisible((v) => !v)}
                tabIndex={-1}
              />
            }
          >
            {visible ? (
              <EyeOff className="size-4" aria-hidden />
            ) : (
              <Eye className="size-4" aria-hidden />
            )}
          </TooltipTrigger>
          <TooltipContent>{visible ? 'Hide password' : 'Show password'}</TooltipContent>
        </Tooltip>
      </div>
    );
  },
);
