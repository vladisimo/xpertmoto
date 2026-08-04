-- Fleet GPS operational alerts: new notification types for the gps51-alerts job
-- (a tracker that has gone offline, or a vehicle reporting a low battery/voltage).
-- Additive enum values — safe, non-destructive.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TRACKER_OFFLINE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TRACKER_LOW_BATTERY';
