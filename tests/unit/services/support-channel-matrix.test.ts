import { describe, expect, it } from "vitest";
import {
  resolveChannels,
  resolveCustomerChannels,
} from "../../../src/server/services/support-channel-matrix";

describe("resolveChannels", () => {
  it("fires immediate SMS for URGENT breakdown", () => {
    const plan = resolveChannels({
      category: "BREAKDOWN",
      priority: "URGENT",
      outsideHours: false,
    });
    expect(plan.toAssignee).toEqual(["SMS", "EMAIL", "IN_APP"]);
    expect(plan.toOnCall).toEqual(["SMS"]);
  });

  it("adds onCall EMAIL when URGENT breakdown is out of hours", () => {
    const plan = resolveChannels({
      category: "BREAKDOWN",
      priority: "URGENT",
      outsideHours: true,
    });
    expect(plan.toOnCall).toContain("SMS");
    expect(plan.toOnCall).toContain("EMAIL");
  });

  it("HIGH breakdown in-hours is email + in-app only", () => {
    const plan = resolveChannels({
      category: "BREAKDOWN",
      priority: "HIGH",
      outsideHours: false,
    });
    expect(plan.toAssignee).toEqual(["EMAIL", "IN_APP"]);
    expect(plan.toOnCall).toEqual([]);
  });

  it("NORMAL breakdown out-of-hours gets SMS", () => {
    const plan = resolveChannels({
      category: "BREAKDOWN",
      priority: "NORMAL",
      outsideHours: true,
    });
    expect(plan.toAssignee).toContain("SMS");
  });

  it("PAYMENT never emits SMS — routed to admin pool email + in-app", () => {
    const plan = resolveChannels({
      category: "PAYMENT",
      priority: "URGENT",
      outsideHours: true,
    });
    expect(plan.toAssignee).toEqual([]);
    expect(plan.toOnCall).toEqual([]);
    expect(plan.toAdminPool).toEqual(["EMAIL", "IN_APP"]);
  });

  it("GENERAL routes in-app only to depot staff when escalated", () => {
    const plan = resolveChannels({
      category: "GENERAL",
      priority: "LOW",
      outsideHours: false,
    });
    expect(plan.toAssignee).toEqual(["IN_APP"]);
    expect(plan.toAdminPool).toEqual([]);
  });
});

describe("resolveCustomerChannels", () => {
  it("staff reply always goes EMAIL + IN_APP", () => {
    expect(resolveCustomerChannels({ kind: "staff_reply", priority: "URGENT" })).toEqual([
      "EMAIL",
      "IN_APP",
    ]);
  });
  it("urgent status change to URGENT ticket also SMSes the customer", () => {
    expect(resolveCustomerChannels({ kind: "urgent_status", priority: "URGENT" })).toEqual([
      "SMS",
      "EMAIL",
      "IN_APP",
    ]);
  });
  it("urgent status on NORMAL ticket still email-only", () => {
    expect(resolveCustomerChannels({ kind: "urgent_status", priority: "NORMAL" })).toEqual([
      "EMAIL",
      "IN_APP",
    ]);
  });
});
