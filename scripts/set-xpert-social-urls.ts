/**
 * One-off: persist XPERT Moto's public social URLs into SystemSetting so
 * `getBranding()` surfaces the icons in the public footer.
 *
 * Run: `npx tsx scripts/set-xpert-social-urls.ts`
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const URLS: Record<string, string> = {
  "org.facebookUrl": "https://www.facebook.com/xpertmoto.com.au/",
  "org.instagramUrl": "https://www.instagram.com/xpert_moto_group/",
  "org.tiktokUrl": "https://www.tiktok.com/@xpertmotogroup",
  "org.youtubeUrl": "https://www.youtube.com/@xpertmotoau",
};

async function main() {
  for (const [key, value] of Object.entries(URLS)) {
    await prisma.systemSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
    console.log(`set ${key} = ${value}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
