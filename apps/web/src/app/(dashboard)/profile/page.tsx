'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@hrms/ui/components/avatar';
import { Badge } from '@hrms/ui/components/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { Separator } from '@hrms/ui/components/separator';
import { FadeInItem, Stagger } from '@/components/motion';
import { useSession } from '@/components/session-provider';
import { displayName, userInitials } from '@/components/user-menu';
import { ChangePasswordForm } from '@/features/auth/components/change-password-form';
import { DocumentsBrowser } from '@/features/documents/documents-browser';
import { MyHrProfile } from '@/features/employees/components/my-hr-profile';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="font-medium text-sm">{value}</dd>
    </div>
  );
}

export default function ProfilePage() {
  const { user } = useSession();
  if (!user) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1>My profile</h1>
        <p className="text-muted-foreground text-sm">Your account and security settings</p>
      </div>

      <Stagger className="grid items-start gap-6 lg:grid-cols-2">
        <FadeInItem>
          <Card>
            <CardHeader>
              <div className="flex items-center gap-4">
                <Avatar className="size-14">
                  {user.employee?.avatarUrl && <AvatarImage src={user.employee.avatarUrl} alt="" />}
                  <AvatarFallback className="text-lg">{userInitials(user)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <CardTitle className="truncate text-lg">{displayName(user)}</CardTitle>
                  <CardDescription className="truncate">{user.email}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3">
                <Row label="Role" value={<Badge variant="secondary">{user.roleCode}</Badge>} />
                <Row
                  label="Status"
                  value={
                    <Badge className="border-transparent bg-success/15 text-success-text">
                      {user.status}
                    </Badge>
                  }
                />
                {user.employee && (
                  <>
                    <Separator />
                    <Row label="Employee" value={displayName(user)} />
                    <Row label="Designation" value={user.employee.designation ?? '—'} />
                  </>
                )}
                {!user.employee && (
                  <>
                    <Separator />
                    <p className="text-muted-foreground text-sm">
                      No employee record is linked to this account yet. HR details will appear here
                      once the Employees module assigns one.
                    </p>
                  </>
                )}
              </dl>
            </CardContent>
          </Card>
        </FadeInItem>

        <FadeInItem>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Change password</CardTitle>
              <CardDescription>
                Changing your password signs you out on every other device
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChangePasswordForm />
            </CardContent>
          </Card>
        </FadeInItem>

        <FadeInItem className="lg:col-span-2">
          <MyHrProfile />
        </FadeInItem>

        {user.employee && (
          <FadeInItem className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Documents</CardTitle>
                <CardDescription>Your files, organised into folders</CardDescription>
              </CardHeader>
              <CardContent>
                <DocumentsBrowser employeeId={user.employee.id} compact />
              </CardContent>
            </Card>
          </FadeInItem>
        )}
      </Stagger>
    </div>
  );
}
