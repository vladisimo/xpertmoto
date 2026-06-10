import { createTRPCRouter, publicProcedure } from "../trpc";
import { vehicleRouter } from "./vehicle";
import { depotRouter } from "./depot";
import { bookingRouter } from "./booking";
import { bookingSettlementRouter } from "./booking-settlement";
import { bookingSwapRouter } from "./booking-swap";
import { customerRouter } from "./customer";
import { authRouter } from "./auth";
import { inviteRouter } from "./invite";
import { catalogRouter } from "./catalog";
import { staffBookingRouter } from "./staff-booking";
import { staffCustomerRouter } from "./staff-customer";
import { staffTaskRouter } from "./staff-task";
import { inspectionRouter } from "./inspection";
import { fleetRouter } from "./fleet";
import { adminRouter } from "./admin";
import { etollRouter } from "./etoll";
import { linktRouter } from "./linkt";
import { agreementRouter } from "./agreement";
import { returnRouter } from "./return";
import { damageTariffRouter } from "./damage-tariff";
import { communicationRouter } from "./communication";
import { supportRouter } from "./support";
import { liveRouter } from "./live";
import { liveAnalyticsRouter } from "./live-analytics";
import { analyticsConfigRouter } from "./analytics-config";
import { giftCardRouter } from "./gift-card";
import { reviewRouter } from "./review";
import { referralRouter } from "./referral";
import { loyaltyRouter } from "./loyalty";
import { subscriptionRouter } from "./subscription";
import { partnerRouter } from "./partner";
import { yieldPricingRouter } from "./yield-pricing";
import { telematicsRevenueRouter } from "./telematics-revenue";
import { devToolsRouter } from "./devTools";
import { insightsRouter } from "./insights";
import { vehicleModelRouter } from "./vehicleModel";
import { sessionRouter } from "./session";
import { totpRouter } from "./totp";
import { backupRouter } from "./backup";
import { impersonationRouter } from "./impersonation";
import { profileRouter } from "./profile";
import { webhookHealthRouter } from "./webhook-health";
import { platformRouter } from "./platform";
import { onboardingRouter } from "./onboarding";
import { globalSearchRouter } from "./global-search";

export const appRouter = createTRPCRouter({
  health: publicProcedure.query(() => ({ status: "ok", time: new Date().toISOString() })),
  auth: authRouter,
  invite: inviteRouter,
  vehicle: vehicleRouter,
  depot: depotRouter,
  booking: bookingRouter,
  bookingSettlement: bookingSettlementRouter,
  bookingSwap: bookingSwapRouter,
  customer: customerRouter,
  catalog: catalogRouter,
  staffBooking: staffBookingRouter,
  staffCustomer: staffCustomerRouter,
  staffTask: staffTaskRouter,
  inspection: inspectionRouter,
  fleet: fleetRouter,
  admin: adminRouter,
  etoll: etollRouter,
  linkt: linktRouter,
  agreement: agreementRouter,
  return: returnRouter,
  damageTariff: damageTariffRouter,
  communication: communicationRouter,
  support: supportRouter,
  live: liveRouter,
  liveAnalytics: liveAnalyticsRouter,
  analyticsConfig: analyticsConfigRouter,
  giftCard: giftCardRouter,
  review: reviewRouter,
  referral: referralRouter,
  loyalty: loyaltyRouter,
  subscription: subscriptionRouter,
  partner: partnerRouter,
  yieldPricing: yieldPricingRouter,
  telematicsRevenue: telematicsRevenueRouter,
  devTools: devToolsRouter,
  insights: insightsRouter,
  vehicleModel: vehicleModelRouter,
  session: sessionRouter,
  totp: totpRouter,
  backup: backupRouter,
  impersonation: impersonationRouter,
  profile: profileRouter,
  webhookHealth: webhookHealthRouter,
  platform: platformRouter,
  onboarding: onboardingRouter,
  globalSearch: globalSearchRouter,
});

export type AppRouter = typeof appRouter;
