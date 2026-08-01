'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@hrms/ui/components/avatar';
import { Button } from '@hrms/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@hrms/ui/components/dropdown-menu';
import { LogOut, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from '@/components/session-provider';

export function userInitials(user: {
  email: string;
  employee?: { firstName: string; lastName: string } | null;
}): string {
  if (user.employee) {
    return `${user.employee.firstName[0] ?? ''}${user.employee.lastName[0] ?? ''}`.toUpperCase();
  }
  return user.email.slice(0, 2).toUpperCase();
}

export function displayName(user: {
  email: string;
  employee?: { firstName: string; lastName: string } | null;
}): string {
  return user.employee ? `${user.employee.firstName} ${user.employee.lastName}` : user.email;
}

export function UserMenu() {
  const { user, logout } = useSession();
  const router = useRouter();
  if (!user) return null;

  return (
    <DropdownMenu>
      {/* No aria-label: it would override the visible name and break
          voice control ("click Asha Verma"). The sr-only span names the
          button when the visible name is hidden below sm. */}
      <DropdownMenuTrigger render={<Button variant="ghost" className="gap-2 px-2" />}>
        <Avatar className="size-7">
          {user.employee?.avatarUrl && <AvatarImage src={user.employee.avatarUrl} alt="" />}
          <AvatarFallback className="text-xs">{userInitials(user)}</AvatarFallback>
        </Avatar>
        <span className="hidden max-w-40 truncate text-sm sm:inline">{displayName(user)}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate font-medium text-sm">{displayName(user)}</p>
          <p className="truncate text-muted-foreground text-xs">{user.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/profile" />}>
          <UserRound aria-hidden /> My profile
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={async () => {
            await logout();
            router.replace('/login');
          }}
        >
          <LogOut aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
