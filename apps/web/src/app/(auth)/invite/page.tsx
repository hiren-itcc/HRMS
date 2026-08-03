import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AcceptInviteForm } from '@/features/auth/components/accept-invite-form';

export const metadata: Metadata = { title: 'Accept your invitation' };

export default function InvitePage() {
  return (
    <Suspense>
      <AcceptInviteForm />
    </Suspense>
  );
}
