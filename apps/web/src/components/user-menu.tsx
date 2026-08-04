'use client';

import type { RoleCodeInput } from '@hrms/shared';
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
import { ACCOUNT_LABEL } from '@/features/employees/role-options';

/**
 * Not every account is a person. The bootstrapped administrator has no
 * employee record on purpose — it exists to set the company up — so there is
 * no first or last name to show, and falling back to the raw email put
 * `hiren1573@gmail.com` where a name belongs, twice over in the menu that
 * already prints the email underneath.
 *
 * Such an account is named by what it is instead: Super Admin.
 */
interface NameableUser {
  email: string;
  roleCode: RoleCodeInput;
  employee?: { firstName: string; lastName: string } | null;
}

export function displayName(user: NameableUser): string {
  if (user.employee) return `${user.employee.firstName} ${user.employee.lastName}`;
  return ACCOUNT_LABEL[user.roleCode] ?? user.email;
}

export function userInitials(user: NameableUser): string {
  // Initials of whatever displayName settled on, so the avatar and the name
  // can never disagree — "SA" beside "Super Admin", not "HI".
  const words = displayName(user).split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1 ? `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}` : (words[0] ?? '');
  return letters.slice(0, 2).toUpperCase();
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
