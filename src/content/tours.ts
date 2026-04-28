export interface TourGalleryImage {
  src: string;
  alt: string;
}

export interface Tour {
  slug: string;
  number: string;
  name: string;
  distanceKm: number;
  durationHours: number;
  departsAt: string;
  returnsAt: string;
  location: string;
  description: string;
  gallery: [TourGalleryImage, ...TourGalleryImage[]];
}

const t = (
  slug: string,
  files: [[string, string], ...[string, string][]],
): [TourGalleryImage, ...TourGalleryImage[]] => {
  const [head, ...rest] = files;
  return [
    { src: `/tours/${slug}/${head[0]}`, alt: head[1] },
    ...rest.map(([file, alt]) => ({ src: `/tours/${slug}/${file}`, alt })),
  ];
};

export const TOURS: Tour[] = [
  {
    slug: "sydney-scenic-ride",
    number: "1",
    name: "Sydney Scenic Ride",
    distanceKm: 210,
    durationHours: 7,
    departsAt: "9:00 AM",
    returnsAt: "~4:00 PM",
    location: "Sydney",
    description:
      "Sydney boasts some of the most beautiful beaches in the world, offering a paradise of surf and sand. The city is also encircled by breathtaking national parks, vibrant rainforests, and marine reserves.",
    gallery: t("sydney-scenic-ride", [
      ["01-palm-beach.jpg", "Palm Beach coastal scenery"],
      ["02-barrenjoey-lighthouse.jpg", "Barrenjoey Lighthouse"],
      ["03-church-point.jpg", "Church Point"],
      ["04-manly-beach.jpg", "Manly Beach"],
      ["05-woolloomooloo.jpg", "Woolloomooloo"],
      ["06-watsons-bay.jpg", "Watsons Bay"],
      ["07-macquarie-lighthouse.jpg", "Macquarie Lighthouse"],
      ["08-bondi-beach.jpg", "Bondi Beach"],
      ["09-coogee-beach.jpg", "Coogee Beach"],
      ["10-captain-cook.jpg", "Captain Cook arrival spot"],
    ]),
  },
  {
    slug: "sydney-to-blue-mountains",
    number: "2",
    name: "Sydney to Blue Mountains",
    distanceKm: 280,
    durationHours: 8,
    departsAt: "9:00 AM",
    returnsAt: "~5:00 PM",
    location: "Sydney",
    description:
      "Embark on a scenic journey from Sydney along the Bells Line of Road to the breathtaking Blue Mountains. This harmonious adventure blends excitement and tranquility, showcasing nature's splendor at its finest.",
    gallery: t("sydney-to-blue-mountains", [
      ["01-wisemans-ferry.jpg", "Wiseman's Ferry crossing"],
      ["02-bells-line.jpg", "Bells Line of Road"],
      ["03-bilpin.jpg", "Bilpin Apple Land"],
      ["04-mount-tomah.jpg", "Mount Tomah"],
      ["05-govetts-leap.jpg", "Govetts Leap Lookout"],
      ["06-katoomba.jpg", "Katoomba"],
      ["07-blue-mountains.jpg", "Blue Mountains"],
      ["08-echo-point.jpg", "Echo Point"],
      ["09-three-sisters.jpg", "Three Sisters rock formation"],
      ["10-hawkesbury-lookout.jpg", "Hawkesbury Lookout"],
    ]),
  },
  {
    slug: "sydney-to-wollongong",
    number: "3",
    name: "Sydney to Wollongong",
    distanceKm: 240,
    durationHours: 8,
    departsAt: "9:00 AM",
    returnsAt: "~5:00 PM",
    location: "Sydney",
    description:
      "The ride from Sydney to Wollongong offers a bit of everything, featuring subtropical rainforests, sandstone headlands, dramatic coastal cliffs, and pristine beaches.",
    gallery: t("sydney-to-wollongong", [
      ["01-royal-national-park.jpg", "Royal National Park"],
      ["02-garie-beach.jpg", "Garie Beach"],
      ["03-grand-pacific-drive.jpg", "Grand Pacific Drive"],
      ["04-stanwell-tops.jpg", "Stanwell Tops Lookout"],
      ["05-sea-cliff-bridge.jpg", "Sea Cliff Bridge"],
      ["06-stuart-park.jpg", "Stuart Park"],
      ["07-wollongong-harbour.jpg", "Wollongong Harbour"],
      ["08-breakwater-lighthouse.jpg", "Breakwater Lighthouse"],
      ["09-mount-keira.jpg", "Mount Keira"],
      ["10-nan-tien-temple.jpg", "Nan Tien Temple"],
    ]),
  },
  {
    slug: "hunter-valley-loop",
    number: "4",
    name: "Hunter Valley Loop",
    distanceKm: 420,
    durationHours: 10,
    departsAt: "8:00 AM",
    returnsAt: "~6:00 PM",
    location: "Sydney",
    description:
      "The journey traverses the Hunter Valley, celebrated as one of Australia's top wine-producing regions. Yet, the wineries are only a small part of the area's appeal.",
    gallery: t("hunter-valley-loop", [
      ["01-the-old-road.jpg", "The Old Road"],
      ["02-wollombi-road.jpg", "Wollombi Road"],
      ["03-timber-bridge.jpg", "Timber Bridge crossing"],
      ["04-wollomi-national-park.jpg", "Wollemi National Park"],
      ["05-lower-hunter-wine-region.jpg", "Lower Hunter wine region"],
      ["06-pokolbin-village.jpg", "Pokolbin Village"],
      ["07-hunter-valley-gardens.jpg", "Hunter Valley Gardens"],
      ["08-sackville-ferry.jpg", "Sackville Ferry crossing"],
      ["09-yengo-national-park.jpg", "Yengo National Park"],
      ["10-putty-road.jpg", "Putty Road"],
    ]),
  },
  {
    slug: "north-coast-ride",
    number: "5",
    name: "North Coast Ride",
    distanceKm: 460,
    durationHours: 10,
    departsAt: "8:00 AM",
    returnsAt: "~6:00 PM",
    location: "Sydney",
    description:
      "The North Coast Ride invites you to explore some of Australia's most iconic vacation spots, featuring endless stretches of beautiful beaches, charming coastal towns, untouched wilderness, and an almost ideal subtropical climate.",
    gallery: t("north-coast-ride", [
      ["01-wollombi-road.jpg", "Wollombi Road"],
      ["02-old-pacific-highway.jpg", "Old Pacific Highway"],
      ["03-mount-tomaree.jpg", "Mount Tomaree"],
      ["04-zenith-beach.jpg", "Zenith Beach"],
      ["05-stockton-bridge.jpg", "Stockton Bridge"],
      ["06-newcastle.jpg", "Newcastle"],
      ["07-nobbys-lighthouse.jpg", "Nobby's Lighthouse"],
      ["08-strzelecki-lookout.jpg", "Strzelecki Lookout"],
      ["09-wisemans-ferry.jpg", "Wiseman's Ferry"],
      ["10-bobbin-head.jpg", "Bobbin Head"],
    ]),
  },
  {
    slug: "grand-pacific-ride",
    number: "6",
    name: "Grand Pacific Ride",
    distanceKm: 420,
    durationHours: 10,
    departsAt: "8:00 AM",
    returnsAt: "~6:00 PM",
    location: "Sydney",
    description:
      "The rolling hills of the South Coast offer picturesque rides along lanes lined with dry stone walls, classic farmhouses, and dairies. Many lookouts along the way provide a bird's-eye view of the entire district and coastline.",
    gallery: t("grand-pacific-ride", [
      ["01-royal-national-park.jpg", "Royal National Park"],
      ["02-grand-pacific-drive.jpg", "Grand Pacific Drive"],
      ["03-wollongong-harbour.jpg", "Wollongong Harbour"],
      ["04-breakwater-lighthouse.jpg", "Breakwater Lighthouse"],
      ["05-illawarra-loop.jpg", "Illawarra Loop"],
      ["06-macquarie-pass.jpg", "Macquarie Pass National Park"],
      ["07-fitzroy-falls.jpg", "Fitzroy Falls"],
      ["08-kangaroo-valley.jpg", "Kangaroo Valley"],
      ["09-cambewarra-lookout.jpg", "Cambewarra Lookout"],
      ["10-kiama-light.jpg", "Kiama Light and Blowhole"],
    ]),
  },
  {
    slug: "twisty-and-touristic",
    number: "7",
    name: "Twisty & Touristic",
    distanceKm: 230,
    durationHours: 8,
    departsAt: "9:00 AM",
    returnsAt: "~5:00 PM",
    location: "Sydney",
    description:
      "The lively scenery boasts a wealth of exhilarating roads, featuring winding turns and sharp hairpin bends that will thrill even the most daring riders.",
    gallery: t("twisty-and-touristic", [
      ["01-hawkings-lookout.jpg", "Hawkings Lookout"],
      ["02-wisemans-village.jpg", "Wiseman's Village"],
      ["03-webbs-creek-ferry.jpg", "Webbs Creek Ferry"],
      ["04-saint-albans.jpg", "Saint Albans"],
      ["05-hawkesbury-river.jpg", "Hawkesbury River"],
      ["06-old-pacific-highway.jpg", "Old Pacific Highway"],
      ["07-bobbin-head.jpg", "Bobbin Head"],
      ["08-sphinx-memorial.jpg", "Sphinx Memorial"],
      ["09-ku-ring-gai.jpg", "Ku-ring-gai National Park"],
      ["10-church-point.jpg", "Church Point"],
    ]),
  },
];

export const TOUR_FAQS: { q: string; a: string }[] = [
  {
    q: "What can I expect on a Sydney motorcycle adventure tour?",
    a: "With Xpert Tours, you can expect an immersive journey through scenic routes around Sydney, combining thrill and beauty. Our adventure motorcycle tours offer breathtaking views, curated stops, and local insights to make your Sydney experience truly unforgettable.",
  },
  {
    q: "Are there guided motorcycle tours around Sydney, Australia, for beginners?",
    a: "Absolutely! Xpert Tours offers guided motorcycle tours in Sydney, Australia, tailored for all skill levels. Our expert guides prioritize safety and ensure beginners can comfortably explore Sydney's best routes and landmarks on two wheels.",
  },
  {
    q: "How can I book the best guided motorcycle tours in Sydney?",
    a: "Booking the best guided motorcycle tours in Sydney with Xpert Tours is simple. Visit our website, choose from a range of tours suited to your adventure style, and reserve your spot online. Our team is also available to assist with any questions you may have.",
  },
  {
    q: "What are the top-rated adventure motorcycle tours in Australia?",
    a: "Xpert Tours is proud to offer some of the top-rated adventure motorcycle tours in Australia, featuring iconic routes and diverse landscapes. Our tours provide a unique way to experience Australia, from cityscapes in Sydney to rugged coastlines and hidden trails.",
  },
  {
    q: "Why choose a motorcycle tour over a traditional tour in Sydney?",
    a: "Choosing a motorcycle tour with Xpert Tours means experiencing Sydney in a way that goes beyond typical sightseeing. Enjoy the freedom of the open road, explore hidden gems, and connect with Australia's natural beauty from a motorcyclist's perspective.",
  },
  {
    q: "What's included in Australian motorcycle tours and rentals?",
    a: "Our Australian motorcycle tours and rentals at Xpert Tours include high-quality bike rentals, safety gear, and guided routes. Our adventure packages feature must-see destinations, providing an all-in-one touring experience.",
  },
  {
    q: "How do Aussie motorcycle tours differ from standard tours in Sydney?",
    a: "Aussie motorcycle tours, like those offered by Xpert Tours, provide a more thrilling, immersive experience compared to standard bus tours. You'll ride along scenic routes with an expert guide, allowing you to feel the adventure of Sydney firsthand.",
  },
  {
    q: "Are there specific routes for adventure motorcycle tours around Sydney, Australia?",
    a: "Yes! Xpert Tours has designed specific adventure motorcycle tour routes around Sydney, Australia, to showcase the region's most beautiful landscapes. Our routes include coastal roads, mountain views, and picturesque countryside trails to give you a complete experience.",
  },
  {
    q: "What's the difference between adventure motorcycle tours and city motorcycle tours in Sydney?",
    a: "With Xpert Tours, you can choose between city motorcycle tours for a cultural ride through Sydney's urban landscape or adventure motorcycle tours that take you into the countryside and beyond, exploring Australia's natural beauty in its full glory.",
  },
  {
    q: "How should I prepare for a motorcycle adventure tour in Australia?",
    a: "At Xpert Tours, we recommend that riders prepare by bringing comfortable riding gear, checking the weather, and familiarizing themselves with Australian road rules. Our team also provides all necessary safety equipment and guidance before the ride.",
  },
  {
    q: "Can I customize my Australian motorcycle tour in Sydney?",
    a: "Definitely! Xpert Tours offers customizable Australian motorcycle tours in Sydney. Whether you want to visit specific landmarks or enjoy a leisurely ride, we're happy to tailor your tour for a personalized adventure. Just contact us and let us know how we can help you!",
  },
  {
    q: "What's the best time of year for motorcycle tours in Sydney, Australia?",
    a: "Sydney's mild climate makes it suitable for motorcycle tours year-round, but spring and autumn are particularly beautiful. At Xpert Tours, we ensure that every season's unique charm is reflected in our route selection and stops.",
  },
  {
    q: "Do Sydney motorcycle tours include stops at popular Australian landmarks?",
    a: "Yes! Our Sydney motorcycle tours at Xpert Tours include stops at renowned Australian landmarks and scenic spots. You'll have the chance to explore Sydney's famous beaches, parks, and viewpoints along the way.",
  },
  {
    q: "What safety measures are in place for adventure motorcycle tours in Sydney?",
    a: "Safety is a top priority at Xpert Tours. Our adventure motorcycle tours in Sydney include professional guides, high-quality bikes, and necessary safety gear. We provide a thorough briefing before each ride to ensure all riders are comfortable and confident.",
  },
  {
    q: "Are there options to rent motorcycles for self-guided tours in Sydney?",
    a: "Xpert Tours offers rentals for those interested in self-guided tours. This allows you to explore Sydney's landscape at your own pace while still enjoying high-quality motorcycles and recommendations from our team on the best routes.",
  },
  {
    q: "What makes Australian motorcycle tours a unique way to explore the country?",
    a: "Australian motorcycle tours, such as those by Xpert Tours, offer an adventurous, up-close experience of the landscape. Feel the road beneath you, breathe in the fresh air, and enjoy the stunning natural surroundings only accessible by motorcycle.",
  },
  {
    q: "Can I find motorcycle tours in Australia that cater to both beginners and experts?",
    a: "Xpert Tours offers motorcycle tours in Australia suited for all skill levels, from beginners to seasoned riders. Our tours are designed with a variety of routes, allowing each participant to have a comfortable, enjoyable experience.",
  },
  {
    q: "How long do typical Sydney motorcycle tours last, and what's the distance covered?",
    a: "Typical Sydney motorcycle tours with Xpert Tours range from half-day rides covering 50–80 kilometers to full-day tours spanning up to 200 kilometers, depending on the chosen route and stops.",
  },
  {
    q: "What are some benefits of booking guided motorcycle tours in Australia?",
    a: "Booking guided motorcycle tours in Australia with Xpert Tours means you'll have expert guides, curated routes, and all necessary safety gear. Our team ensures you experience Australia's best sights with convenience and adventure in mind.",
  },
];

export const getTour = (slug: string): Tour | undefined =>
  TOURS.find((tour) => tour.slug === slug);

export const whatsappUrl = (text: string): string =>
  `https://wa.me/61433880748?text=${encodeURIComponent(text)}`;
