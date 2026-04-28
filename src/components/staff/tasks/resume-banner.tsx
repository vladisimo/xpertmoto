"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import type { StaffTaskActivity } from "@prisma/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { TASK_TYPE_LABEL } from "@/lib/tasks/tiers";
import { PlayCircle, CheckCircle2, XCircle } from "lucide-react";

interface ResumeBannerProps {
  activities: StaffTaskActivity[];
  onContinue: (activityId: string, actionUrl: string) => void;
  onComplete: (activityId: string) => void;
  onAbandon: (activityId: string) => void;
}

export function ResumeBanner({ activities, onContinue, onComplete, onAbandon }: ResumeBannerProps) {
  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <PlayCircle className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">You have work in progress</span>
        </div>
        <ul className="space-y-2">
          {activities.map((a) => (
            <ResumeRow
              key={a.id}
              activity={a}
              onContinue={onContinue}
              onComplete={onComplete}
              onAbandon={onAbandon}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ResumeRow({
  activity,
  onContinue,
  onComplete,
  onAbandon,
}: {
  activity: StaffTaskActivity;
  onContinue: (activityId: string, actionUrl: string) => void;
  onComplete: (activityId: string) => void;
  onAbandon: (activityId: string) => void;
}) {
  const [elapsed, setElapsed] = useState(() =>
    Math.max(0, Math.round((Date.now() - new Date(activity.startedAt).getTime()) / 1000)),
  );
  const router = useRouter();
  const heartbeat = trpc.staffTask.heartbeat.useMutation();

  useEffect(() => {
    const tick = setInterval(() => {
      setElapsed(Math.max(0, Math.round((Date.now() - new Date(activity.startedAt).getTime()) / 1000)));
    }, 1000);
    const hb = setInterval(() => {
      heartbeat.mutate({ activityId: activity.id });
    }, 60_000);
    return () => {
      clearInterval(tick);
      clearInterval(hb);
    };
  }, [activity.id, activity.startedAt, heartbeat]);

  const actionUrl = resolveActionUrl(activity);

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-background p-3">
      <StatusBadge status={activity.tierSnapshot} />
      <div className="flex-1">
        <div className="text-sm font-medium">{TASK_TYPE_LABEL[activity.taskType]}</div>
        <div className="text-xs text-muted-foreground">
          {activity.targetEntityKind} · started {formatElapsed(elapsed)} ago
        </div>
      </div>
      <Button
        size="sm"
        onClick={() => {
          if (actionUrl) onContinue(activity.id, actionUrl);
          else router.refresh();
        }}
      >
        Continue
      </Button>
      <Button size="sm" variant="ghost" onClick={() => onComplete(activity.id)}>
        <CheckCircle2 className="mr-1 h-4 w-4" /> Done
      </Button>
      <Button size="sm" variant="ghost" onClick={() => onAbandon(activity.id)}>
        <XCircle className="mr-1 h-4 w-4" /> Abandon
      </Button>
    </li>
  );
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
}

function resolveActionUrl(a: StaffTaskActivity): string | null {
  switch (a.taskType) {
    case "BOOKING_PICKUP":
      return `/staff/bookings/${a.targetEntityId}/check-out`;
    case "BOOKING_RETURN":
    case "BOOKING_OVERDUE_CHASE":
      return `/staff/bookings/${a.targetEntityId}/check-in`;
    case "MAINTENANCE_WORK_ORDER":
      return `/staff/maintenance/${a.targetEntityId}`;
    case "INSPECTION_PRE_HIRE": {
      const bookingId = (a.metadata as { bookingId?: string } | null)?.bookingId;
      return bookingId
        ? `/staff/bookings/${bookingId}/check-out/inspect`
        : `/staff/inspections/${a.targetEntityId}`;
    }
    case "INSPECTION_POST_HIRE": {
      const bookingId = (a.metadata as { bookingId?: string } | null)?.bookingId;
      return bookingId
        ? `/staff/bookings/${bookingId}/check-in/inspect`
        : `/staff/inspections/${a.targetEntityId}`;
    }
    case "RENTAL_AGREEMENT_SIGN": {
      const bookingId = (a.metadata as { bookingId?: string } | null)?.bookingId;
      return bookingId ? `/staff/bookings/${bookingId}/check-out/sign` : null;
    }
    case "RETURN_ASSESSMENT_FINALISE": {
      const bookingId = (a.metadata as { bookingId?: string } | null)?.bookingId;
      return bookingId ? `/staff/bookings/${bookingId}/check-in/settle` : null;
    }
    default:
      return null;
  }
}
