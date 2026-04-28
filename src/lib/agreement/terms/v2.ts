export type TermsSection = {
  heading: string;
  paragraphs: string[];
};

export type Terms = {
  version: string;
  effective: string;
  preamble: string[];
  sections: TermsSection[];
};

export const TERMS_V2: Terms = {
  version: "2.0",
  effective: "2026-04-01",
  preamble: [
    "This agreement is entered into between {{legalName}} ({{abnClause}}) (\u201c{{siteName}}\u201d, \u201cwe\u201d, \u201cus\u201d) and the customer named on the cover page of this rental agreement (\u201cyou\u201d, \u201cthe hirer\u201d). By signing this agreement, you accept and are bound by all terms below, the pre-hire condition report, the pricing summary, and the bond and cancellation policy.",
  ],
  sections: [
    {
      heading: "1. Eligibility and licence",
      paragraphs: [
        "You must hold a current, valid licence of the class required for the category of vehicle being hired, and you must meet the minimum age for that category. Your licence must not be subject to any suspension, cancellation or disqualification in Australia or any other jurisdiction.",
        "You acknowledge that the vehicle may only be driven by you or by another person expressly named on this agreement as an \u201cadditional driver\u201d who has also presented a valid licence and signed this agreement.",
        "You consent to {{siteName}} verifying the currency and class of your licence at any time during the hire period.",
      ],
    },
    {
      heading: "2. Use of the vehicle",
      paragraphs: [
        "You must drive the vehicle safely, lawfully and with reasonable care. You must not drive under the influence of alcohol or any drug (whether legal, prescribed, or otherwise) that impairs your ability to drive.",
        "You must not use the vehicle for racing, off-road riding, for carriage of more passengers than the vehicle is constructed to carry, for towing, or for any commercial passenger service (e.g. food delivery).",
        "You must comply with all traffic laws. You agree that you are solely responsible for all traffic and parking infringements, tolls, and private-land fees incurred during the hire period, regardless of who was driving.",
      ],
    },
    {
      heading: "3. Condition report and pre-hire inspection",
      paragraphs: [
        "Before handover, a pre-hire inspection is completed and photographs are taken of the vehicle. The pre-hire condition report (including the damage map and photographs) forms part of this agreement.",
        "You acknowledge that the condition shown in the pre-hire report is the accepted starting condition of the vehicle. Any damage identified at return that was not recorded on the pre-hire report is your responsibility, subject to clause 5 below.",
      ],
    },
    {
      heading: "4. Bond",
      paragraphs: [
        "A refundable security bond, in the amount disclosed on the pricing summary page of this agreement, is held against your payment method at the commencement of the hire.",
        "The bond may be applied, in whole or in part, against: (a) damage not covered by the insurance tier you selected; (b) late-return fees; (c) fuel shortfall charges; (d) cleaning charges for heavy soiling; (e) infringements and tolls notified to {{siteName}}; (f) the excess applicable to any insurance claim arising from your use of the vehicle.",
        "Any unused portion of the bond is released to you within 14 days of the vehicle being returned and all applicable charges being settled.",
      ],
    },
    {
      heading: "5. Damage, liability, and repair quotes",
      paragraphs: [
        "You agree that you are liable for any damage to the vehicle during the hire period, up to the insurance excess applicable to the tier you selected on the pricing summary.",
        "Minor standardised damage (including common scratches, broken mirrors, replacement helmet, missing key, cleaning) may be charged at the time of return at the published tariff, without the need for a mechanic quote. You may dispute any tariff charge at the time of return.",
        "Where damage requires assessment by a mechanic, {{siteName}} will obtain a quote. Where you have signed a \u201cpending quote acknowledgement\u201d at return, you authorise {{siteName}} to charge your registered payment method for the confirmed repair cost up to the cap you acknowledged, once the mechanic\u2019s quote is finalised. Any amount above the cap will not be charged without your further agreement.",
      ],
    },
    {
      heading: "6. Insurance",
      paragraphs: [
        "The insurance tier you selected, and the applicable excess, is set out on the pricing summary page of this agreement. You acknowledge that you may be required to contribute the excess amount in the event of a claim.",
        "Insurance does not cover: (a) damage caused while driving unlicensed, disqualified, or under the influence; (b) damage caused during unlawful use; (c) damage to third-party property to the extent it exceeds the policy limit; (d) loss of personal belongings left in or on the vehicle.",
      ],
    },
    {
      heading: "7. Incidents and theft",
      paragraphs: [
        "You must notify {{siteName}} as soon as reasonably possible (and in any event within 24 hours) of any collision, theft, fire, damage, mechanical failure, or infringement involving the vehicle.",
        "In the event of theft, you must report the theft to the police, obtain a police report number, and provide that number to {{siteName}} before any insurance claim can be progressed. You must surrender all keys to the vehicle at the time you report the theft.",
      ],
    },
    {
      heading: "8. Return of vehicle",
      paragraphs: [
        "You must return the vehicle to the return depot nominated on the cover page on or before the return date and time. Late returns incur the late fee set out on the pricing summary, subject to a one (1) hour grace period.",
        "You must return the vehicle in a clean condition and with a fuel level no lower than the level recorded at pickup on the pre-hire condition report. Shortfalls attract the fuel charge published in this agreement.",
        "At return, a post-hire inspection is completed in your presence. You will be asked to review and sign the return assessment, which includes any damage charges, late fees, fuel charges, and bond adjustments.",
      ],
    },
    {
      heading: "9. Extensions and changes",
      paragraphs: [
        "Requests to extend the hire must be approved by {{siteName}} in writing before the end of the booked return time. Extensions are subject to vehicle availability and may be declined.",
        "Should your hire be extended, a new rental agreement may be issued to reflect the extended terms. The previous agreement remains on file and is superseded.",
      ],
    },
    {
      heading: "10. Cancellation",
      paragraphs: [
        "Cancellations made more than 72 hours before the scheduled pickup attract a refund of the booking total, less a $25 administration fee.",
        "Cancellations made between 24 and 72 hours before pickup attract a refund of 50% of the booking total.",
        "Cancellations made within 24 hours of pickup, and failures to collect the vehicle at the booked pickup time (\u201cno-shows\u201d), are non-refundable; a no-show fee of $50 may additionally apply.",
      ],
    },
    {
      heading: "11. Privacy",
      paragraphs: [
        "{{siteName}} collects, stores and uses your personal information in accordance with the Australian Privacy Principles and our Privacy Policy. We may share your information with regulatory authorities, insurers, tolling agencies, and mechanics for the purposes of operating the hire, processing payments, and pursuing claims or infringements.",
      ],
    },
    {
      heading: "12. Governing law",
      paragraphs: [
        "This agreement is governed by the laws of the State of New South Wales and the Commonwealth of Australia. Any dispute will be resolved in the courts of that jurisdiction.",
      ],
    },
  ],
};
