-- Add debt reminder notification type for outstanding-balance reminders
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DEBT_REMINDER' BEFORE 'CUSTOM';
