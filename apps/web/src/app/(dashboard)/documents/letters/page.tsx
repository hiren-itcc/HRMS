'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { FadeInItem, Stagger } from '@/components/motion';
import { LettersPanel } from '@/features/letters/components/letters-panel';

/** The letters issued to the signed-in person — offer, appointment, and so on. */
export default function MyLettersPage() {
  return (
    <Stagger className="space-y-6">
      <FadeInItem>
        <Card>
          <CardHeader>
            <CardTitle>My letters</CardTitle>
            <CardDescription>
              Issued by HR — open one to read or print it. They cannot be edited once issued.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LettersPanel />
          </CardContent>
        </Card>
      </FadeInItem>
    </Stagger>
  );
}
