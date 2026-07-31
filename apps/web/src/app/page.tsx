import { Badge } from '@hrms/ui/components/badge';
import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';

export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-success" aria-hidden />
            <Badge variant="secondary">Foundation ready</Badge>
          </div>
          <CardTitle className="text-2xl">HRMS</CardTitle>
          <CardDescription>
            Human Resource Management System — project foundation. Feature modules land per the
            roadmap in <code className="font-mono text-xs">docs/11-roadmap.md</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Button asChild>
            <Link href="/login">Sign in</Link>
          </Button>
          <Button variant="outline" asChild>
            <a href="http://localhost:4000/api/docs" target="_blank" rel="noreferrer">
              API docs
            </a>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
