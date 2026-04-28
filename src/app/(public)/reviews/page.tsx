import type { Metadata } from "next";
import { Star } from "lucide-react";
import { getBranding } from "@/lib/branding";

type Review = {
  name: string;
  rating: number;
  date: string;
  body: string;
};

const REVIEWS: Review[] = [
  { name: "Lai Yujie", rating: 5, date: "16 Apr 2025", body: "Great experience!" },
  { name: "Richard Rettenbeck", rating: 5, date: "12 Apr 2025", body: "Great service and experience!" },
  { name: "Darth Vader", rating: 5, date: "11 Apr 2025", body: "What a fantastic service the team offer and it was perfect for me to rent a 125 for practice in preparation for my P's. The bike worked perfectly and it was extremely good value to boot, see you guys in May for round 2." },
  { name: "Mohammed Kadim", rating: 5, date: "11 Apr 2025", body: "Staff here were amazing, very smooth and quick process to rent a bike. Rented multiple times from them and always a great experience." },
  { name: "Mark O'Callaghan", rating: 5, date: "11 Apr 2025", body: "Excellent service well looked after bike. Would highly recommend." },
  { name: "Alejandro Colorado", rating: 5, date: "11 Apr 2025", body: "I have been renting motorcycles with this company for two years and have never had a problem. They are always attentive and willing to help." },
  { name: "Sunni West", rating: 5, date: "10 Apr 2025", body: "The staff were very friendly, and the bike I rented, a Honda CB125e, was in great condition for how many K's it had!" },
  { name: "Simon Townsend", rating: 5, date: "9 Apr 2025", body: "Very simple, great communication. I'd definitely recommend." },
  { name: "Laura Andre", rating: 5, date: "9 Apr 2025", body: "I recommend, very good rental agency. Communication was very good! See you soon." },
  { name: "Ben McHugh", rating: 5, date: "9 Apr 2025", body: "Had an amazing experience! Thank you!" },
  { name: "Omkar Mehra", rating: 5, date: "8 Apr 2025", body: "Easy to rent and affordable." },
  { name: "徐则霖", rating: 5, date: "5 Apr 2025", body: "Compared with other platforms, the price is better, and the Xmax300 rented is in good condition. It seems to be a scooter shop that mainly serves new immigrant delivery guys, and there are also large-displacement waterbirds. However, the preferential price requires a minimum rent of one week, which is suitable for friends who want to travel around Sydney for more than one week." },
  { name: "Olivier Hassig", rating: 5, date: "5 Apr 2025", body: "They are good, I hired a KTM 200 Duke — it was reliable and had low kms, affordable price. Easy to deal with." },
  { name: "Alex Chenaf", rating: 5, date: "4 Apr 2025", body: "Quick and inexpensive scooter rental. I recommend." },
  { name: "Valentin Borras", rating: 5, date: "3 Apr 2025", body: "Very happy with the service! Erika was amazing at providing personalized attention." },
  { name: "Wei Hao Chen", rating: 5, date: "3 Apr 2025", body: "Good experience! My Dio 110cc is fine." },
  { name: "Yaofeng Xiao", rating: 5, date: "2 Apr 2025", body: "Renting from here is really cheap, I can say that it is the best place to rent a bike in Sydney!" },
  { name: "Thomas Bedou", rating: 5, date: "2 Apr 2025", body: "Go ahead, everything is going well, they are in compliance." },
  { name: "Brett Howard-Butler", rating: 5, date: "2 Apr 2025", body: "Good price, good service." },
  { name: "Zulhaili Azame", rating: 5, date: "2 Apr 2025", body: "Rented the Dio 110 for 3 weeks. Bike was in great condition, very reliable and fuel economy is great!" },
  { name: "Sofiane Rharbaoui", rating: 5, date: "31 Mar 2025", body: "Great service from Steve! I recommend to all my frenchies!" },
  { name: "Atilla Yikilmaz", rating: 5, date: "31 Mar 2025", body: "Great rental agency, very professional, I recommend." },
  { name: "Sam Gryska", rating: 5, date: "31 Mar 2025", body: "Great place, awesome service, super kind people and the bike ran smooth." },
  { name: "Aussie Adam", rating: 5, date: "31 Mar 2025", body: "Hired CB500F for a week. Very well maintained bike. Had some great day trips out of Sydney." },
  { name: "Jan Banasiak", rating: 5, date: "31 Mar 2025", body: "Professional service and great bikes! I rented a motorcycle from this company and I was very impressed. The bikes were in excellent condition, and the staff was friendly and professional. Highly recommend for anyone looking for reliable rental bikes in Sydney!" },
  { name: "Marcel Juffermans", rating: 5, date: "28 Mar 2025", body: "I'm on my Ps and having a great time trying out their range of LAMS approved motorcycles. There's a few I haven't tried yet but have to wait for my full license." },
  { name: "Sara Acevedo Hincapiè", rating: 5, date: "28 Mar 2025", body: "Excellent service, good location." },
  { name: "K Wong", rating: 5, date: "28 Mar 2025", body: "Great services." },
  { name: "Micheal Norford", rating: 5, date: "28 Mar 2025", body: "Great service, helpful staff, and out to keep you on the road." },
  { name: "Philip Rogers", rating: 5, date: "27 Mar 2025", body: "Hired a Yamaha MT07 online from New Zealand for a weekend visit to Sydney. Bike was in very good condition. Had an easy no fuss hire experience and was happy with all my dealings with Scootering. I recommend them and I will use them again." },
  { name: "Marion Pigeau", rating: 5, date: "27 Mar 2025", body: "Very good experience! All was perfect thank you. The bike was almost new!" },
  { name: "Dane Johnson", rating: 5, date: "27 Mar 2025", body: "Fast delivery, and very responsive to correcting an issue with the contents of the delivery. Very happy with service." },
  { name: "Joshua Nichol", rating: 5, date: "26 Mar 2025", body: "Great for hiring and fast processing. Highly recommended." },
  { name: "Sudarshan Man Singh", rating: 5, date: "25 Mar 2025", body: "Pretty reliable and reasonable price. And the service they provide is really good. Well you can also visit them for your personal bike service and repair as well. Highly recommended and much appreciated thanks." },
  { name: "Ignas Puluikis", rating: 5, date: "22 Mar 2025", body: "Smooth sailing, bike was in brand new condition, guys were helpful throughout the process, would rent again." },
  { name: "Antoine Ferreira", rating: 5, date: "20 Mar 2025", body: "Very good experience, I rented a Dio 110cc scooter for 6 months and everything went very well. I recommend!" },
  { name: "Greg Nettheim", rating: 5, date: "18 Mar 2025", body: "Fantastic service, great advice. Steve is the best!" },
  { name: "Ryan Parkin", rating: 3, date: "16 Mar 2025", body: "Experience was ok. Booked the MT09 and was told the day before we landed that it isn't available so just went without a bike. Then came back to take the MT07 for a day later in the week, bike was fine, helmets are all pretty banged up. Beware you'll be charged fees on the bond if you're using international card. $40 AUD of fees on a one day rental BOND is pretty outrageous…. Basically a 15% increase on the rental price." },
  { name: "Duncan Webster", rating: 5, date: "9 Mar 2025", body: "Awesome guys very professional service. I hired a BMW GS 1250 for 2 days and loved every minute. I'll be back!" },
  { name: "Gerard Altura", rating: 5, date: "8 Mar 2025", body: "Great customer service and reliable bike hire. Sanjay and Erica are legends!" },
  { name: "Ed Mac", rating: 5, date: "5 Mar 2025", body: "Highly recommended. Am a learner rider who rented a CB125E for two weeks and was pleased not only with the bike's condition but also with the straightforward rental process. Special mention to Mari who was always happy to help and address any concerns." },
  { name: "Jess Ahern", rating: 5, date: "2 Mar 2025", body: "Very helpful. Great option if your bike is in the shop for repairs. Great guys and good prices." },
  { name: "River Heart", rating: 5, date: "2 Mar 2025", body: "Can absolutely recommend hiring a bike from Scootering. I hired a 125 for the week while I was in Sydney for a holiday. The process of booking and collecting is so easy and all the staff are friendly and made it a great experience. The bike was fun, and worked perfectly. Will come back for sure." },
  { name: "Hampus", rating: 5, date: "1 Mar 2025", body: "Good place to rent a bike from." },
  { name: "M K", rating: 5, date: "1 Mar 2025", body: "I visited from Japan. I rented a CBR300R for one night and two days for my first time using it. The ride was very comfortable and I could see that it was well maintained. The receptionist and mechanic were very kind, and they were very accommodating if I asked them. Also, if I had any trouble with the procedure, they kindly explained it to me. I would definitely use it again!" },
  { name: "Rizal Faiq", rating: 5, date: "28 Feb 2025", body: "I enjoy the motorbike (Steven is the best)." },
  { name: "Cory Moussa", rating: 5, date: "27 Feb 2025", body: "Great bike, great people and great rates." },
  { name: "S M", rating: 5, date: "27 Feb 2025", body: "Excellent service by Sanjay at Lewisham. I just got my Ls and decided to start small with a scooter. I hired a Honda Dio for a couple of weeks to get a feel for it before purchasing a scooter elsewhere. Great service from Sanjay and also the admin team who assisted me with extending the hire and processing my bond refund. Excellent communication and great service. My partner will also consider hiring the road/tour bikes they have for future trips. Thank you!" },
  { name: "Mir S Ansari", rating: 5, date: "21 Feb 2025", body: "Rented a Honda CB125 for my Rider P exam and had it for a week. The staff were easy and flexible and it did the job just fine." },
  { name: "Maciej Borowik", rating: 5, date: "17 Feb 2025", body: "I had an amazing experience with this rental service! My brother-in-law and I booked our ride online, and the staff was very friendly, answering all our additional questions. The bikes were in excellent condition and provided endless fun throughout the days. I highly recommend this service to anyone looking to explore on two wheels, whether you're checking if a specific model suits you or simply seeking fun!" },
  { name: "Victor Meireles", rating: 5, date: "17 Feb 2025", body: "I had a great experience, the process was simple from the start. I really recommend." },
  { name: "Kalle Ojamo", rating: 5, date: "17 Feb 2025", body: "I really recommend it. Good service. Everything was done professionally and the customer service was really good, questions were answered quickly." },
  { name: "Adam Rudd", rating: 5, date: "13 Feb 2025", body: "Great bike (MT-07), rented for a day and took a fantastic ride around the north of Sydney. Highly recommended — just wish I could have rented for more than a day and done more." },
  { name: "Simon Jackson", rating: 5, date: "27 Jan 2025", body: "Excellent service. Hired my favourite bike GS1250 Trophy and spent a weekend in the Blue Mountains riding perfect roads and tracks. Highly recommend and Sanjay went out of his way to accommodate late return!" },
  { name: "Sheldon Dcruz", rating: 5, date: "29 Dec 2024", body: "I had a fantastic experience renting two GS 1250s from this scootering company in Sydney for 3 days. Dealing with Sanjay was a pleasure — he was professional, helpful, and made the entire rental process seamless. The bikes were in excellent condition and ran trouble-free throughout our trip. Highly recommend this service for anyone looking to rent top-quality bikes and experience great customer service. Will definitely rent from them again!" },
  { name: "Michel Le Troadec", rating: 5, date: "24 Nov 2024", body: "It was a really great experience with them, they were extraordinarily patient because I actually speak very little English and they were able to answer each of my questions intelligently and kindly. The bike was impeccable and worked perfectly during a 6000 km road trip. I can only recommend this team." },
];

const AVERAGE = REVIEWS.reduce((s, r) => s + r.rating, 0) / REVIEWS.length;

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`h-4 w-4 ${i < rating ? "fill-primary text-primary" : "text-muted-foreground/30"}`}
        />
      ))}
    </div>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { siteName } = await getBranding();
  return {
    title: `Rental Reviews | ${siteName}`,
    description: `Read real customer reviews of ${siteName} scooter and motorbike hire, sourced from our verified Google reviews.`,
  };
}

export default async function ReviewsPage() {
  const { siteName } = await getBranding();
  return (
    <div className="container max-w-5xl py-12">
      <div className="max-w-2xl">
        <h1 className="h-display">Rental reviews</h1>
        <p className="mt-3 text-muted-foreground">
          Real feedback from riders who&apos;ve hired with {siteName}. Reviews
          are sourced from our verified Google listing.
        </p>
      </div>

      <div className="mt-8 flex items-center gap-4 rounded-lg border bg-card p-6">
        <div className="font-display text-5xl font-bold tracking-tight">{AVERAGE.toFixed(1)}</div>
        <div>
          <Stars rating={Math.round(AVERAGE)} />
          <div className="text-sm text-muted-foreground mt-1">
            Based on {REVIEWS.length} verified customer reviews
          </div>
        </div>
      </div>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        {REVIEWS.map((r, i) => (
          <article key={i} className="rounded-lg border bg-card p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="font-semibold">{r.name}</div>
              <Stars rating={r.rating} />
            </div>
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{r.body}</p>
            <div className="mt-4 pt-4 border-t text-xs text-muted-foreground">{r.date}</div>
          </article>
        ))}
      </div>
    </div>
  );
}
