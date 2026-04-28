-- CreateEnum
CREATE TYPE "TemplateFormat" AS ENUM ('PLAIN_TEXT', 'HTML');

-- AlterTable
ALTER TABLE "NotificationTemplate" ADD COLUMN     "format" "TemplateFormat" NOT NULL DEFAULT 'PLAIN_TEXT';

-- AlterTable
ALTER TABLE "NotificationTemplateVersion" ADD COLUMN     "format" "TemplateFormat" NOT NULL DEFAULT 'PLAIN_TEXT';
