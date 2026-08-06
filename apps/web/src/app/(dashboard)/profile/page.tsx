'use client';

import { Badge } from '@hrms/ui/components/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { Separator } from '@hrms/ui/components/separator';
import { CardColumns } from '@/components/card-columns';
import { EmployeeAvatar } from '@/components/employee-avatar';
import { FadeInItem, Stagger } from '@/components/motion';
import { useSession } from '@/components/session-provider';
import { displayName, userInitials } from '@/components/user-menu';
import { MyAssetsCard } from '@/features/assets/components/my-assets-card';
import { ChangePasswordForm } from '@/features/auth/components/change-password-form';
import { DocumentsBrowser } from '@/features/documents/documents-browser';
import { MyHrProfile } from '@/features/employees/components/my-hr-profile';
import { ROLE_LABEL } from '@/features/employees/role-options';

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

      <Stagger>
        <CardColumns>
          <FadeInItem>
            <Card>
              <CardHeader>
                <div className="flex items-center gap-4">
                  <EmployeeAvatar
                    src={user.employee?.avatarUrl}
                    fallback={userInitials(user)}
                    className="size-14"
                    fallbackClassName="text-lg"
                  />
                  <div className="min-w-0">
                    <CardTitle className="truncate text-lg">{displayName(user)}</CardTitle>
                    <CardDescription className="truncate">{user.email}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <dl className="space-y-3">
                  <Row
                    label="Role"
                    value={
                      <Badge variant="secondary">
                        {ROLE_LABEL[user.roleCode] ?? user.roleCode}
                      </Badge>
                    }
                  />
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
                        No employee record is linked to this account yet. HR details will appear
                        here once the Employees module assigns one.
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

          <FadeInItem className="lg:col-span-2">
            <MyAssetsCard />
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
        </CardColumns>
      </Stagger>
    </div>
  );
}
