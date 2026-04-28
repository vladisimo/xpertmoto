#!/usr/bin/env bash
# One-shot downloader for XPERT Moto tour + mechanic imagery.
# Source: https://xpertmoto.com.au (Shopify CDN).
# Run once from the project root. Safe to re-run (curl --remote-name with -o overwrites).
set -euo pipefail

cd "$(dirname "$0")/.."
TOURS_DIR="public/tours"
MECH_DIR="public/mechanic"
BRANDS_DIR="$MECH_DIR/brands"

mkdir -p "$TOURS_DIR" "$MECH_DIR" "$BRANDS_DIR"

get() {
  local url="$1" out="$2"
  echo "→ $out"
  curl -fsSL "https:$url" -o "$out"
}

# Hero banners
get "//xpertmoto.com.au/cdn/shop/files/xpert-tours-australia-sydney-desktop-banner.jpg?v=1730149723" "$TOURS_DIR/hero-desktop.jpg"
get "//xpertmoto.com.au/cdn/shop/files/xpert-tours-australia-sydney-mobile-banner.jpg?v=1730163240" "$TOURS_DIR/hero-mobile.jpg"

# Tour 1 — Sydney Scenic Ride
mkdir -p "$TOURS_DIR/sydney-scenic-ride"
get "//xpertmoto.com.au/cdn/shop/files/1-palm-beach-tours-motorcycle-australia.jpg?v=1730075106" "$TOURS_DIR/sydney-scenic-ride/01-palm-beach.jpg"
get "//xpertmoto.com.au/cdn/shop/files/2-barrenjoey-lighthouse-tours-motorcycle-australia.jpg?v=1730075106" "$TOURS_DIR/sydney-scenic-ride/02-barrenjoey-lighthouse.jpg"
get "//xpertmoto.com.au/cdn/shop/files/3-church-point-tours-motorcycle-australia.jpg?v=1730075106" "$TOURS_DIR/sydney-scenic-ride/03-church-point.jpg"
get "//xpertmoto.com.au/cdn/shop/files/4-manly-beach-tours-motorcycle-australia.jpg?v=1730075106" "$TOURS_DIR/sydney-scenic-ride/04-manly-beach.jpg"
get "//xpertmoto.com.au/cdn/shop/files/5-woolloomooloo-tours-motorcycle-australia.jpg?v=1730075106" "$TOURS_DIR/sydney-scenic-ride/05-woolloomooloo.jpg"
get "//xpertmoto.com.au/cdn/shop/files/6-watsons-bay-tours-motorcycle-australia.jpg?v=1730075106" "$TOURS_DIR/sydney-scenic-ride/06-watsons-bay.jpg"
get "//xpertmoto.com.au/cdn/shop/files/7-macquarie-lighthouse-tours-motorcycle-australia.jpg?v=1730075106" "$TOURS_DIR/sydney-scenic-ride/07-macquarie-lighthouse.jpg"
get "//xpertmoto.com.au/cdn/shop/files/8-bondi-beach-tours-motorcycle-australia.jpg?v=1730075106" "$TOURS_DIR/sydney-scenic-ride/08-bondi-beach.jpg"
get "//xpertmoto.com.au/cdn/shop/files/9-coogee-beach-tours-motorcycle-australia.jpg?v=1730075106" "$TOURS_DIR/sydney-scenic-ride/09-coogee-beach.jpg"
get "//xpertmoto.com.au/cdn/shop/files/10-captain-cook-arrival-spot-tours-motorcycle-australia.jpg?v=1730075106" "$TOURS_DIR/sydney-scenic-ride/10-captain-cook.jpg"

# Tour 2 — Sydney to Blue Mountains
mkdir -p "$TOURS_DIR/sydney-to-blue-mountains"
get "//xpertmoto.com.au/cdn/shop/files/1-wisemans-ferrytours-motorcycle-australia-adventure.jpg?v=1730073474" "$TOURS_DIR/sydney-to-blue-mountains/01-wisemans-ferry.jpg"
get "//xpertmoto.com.au/cdn/shop/files/2-bells-line-of-roadtours-motorcycle-australia-adventure.jpg?v=1730073474" "$TOURS_DIR/sydney-to-blue-mountains/02-bells-line.jpg"
get "//xpertmoto.com.au/cdn/shop/files/3-bilpin-apple-landtours-motorcycle-australia-adventure.jpg?v=1730073474" "$TOURS_DIR/sydney-to-blue-mountains/03-bilpin.jpg"
get "//xpertmoto.com.au/cdn/shop/files/4-mount-tomahtours-motorcycle-australia-adventure.jpg?v=1730073474" "$TOURS_DIR/sydney-to-blue-mountains/04-mount-tomah.jpg"
get "//xpertmoto.com.au/cdn/shop/files/5-govetts-leap-lookouttours-motorcycle-australia-adventure.jpg?v=1730073474" "$TOURS_DIR/sydney-to-blue-mountains/05-govetts-leap.jpg"
get "//xpertmoto.com.au/cdn/shop/files/6-katoombatours-motorcycle-australia-adventure.jpg?v=1730073474" "$TOURS_DIR/sydney-to-blue-mountains/06-katoomba.jpg"
get "//xpertmoto.com.au/cdn/shop/files/7-blue-mountainstours-motorcycle-australia-adventure.jpg?v=1730073474" "$TOURS_DIR/sydney-to-blue-mountains/07-blue-mountains.jpg"
get "//xpertmoto.com.au/cdn/shop/files/8-echo-pointtours-motorcycle-australia-adventure.jpg?v=1730073474" "$TOURS_DIR/sydney-to-blue-mountains/08-echo-point.jpg"
get "//xpertmoto.com.au/cdn/shop/files/9-three-sisterstours-motorcycle-australia-adventure.jpg?v=1730073474" "$TOURS_DIR/sydney-to-blue-mountains/09-three-sisters.jpg"
get "//xpertmoto.com.au/cdn/shop/files/10-hawkesbury-lookouttours-motorcycle-australia-adventure.jpg?v=1730073474" "$TOURS_DIR/sydney-to-blue-mountains/10-hawkesbury-lookout.jpg"

# Tour 3 — Sydney to Wollongong
mkdir -p "$TOURS_DIR/sydney-to-wollongong"
get "//xpertmoto.com.au/cdn/shop/files/1-royal-national-park-guided-motorcycle-tours-australia.jpg?v=1730073504" "$TOURS_DIR/sydney-to-wollongong/01-royal-national-park.jpg"
get "//xpertmoto.com.au/cdn/shop/files/2-garie-beach-guided-motorcycle-tours-australia.jpg?v=1730073504" "$TOURS_DIR/sydney-to-wollongong/02-garie-beach.jpg"
get "//xpertmoto.com.au/cdn/shop/files/3-grand-pacific-drive-guided-motorcycle-tours-australia.jpg?v=1730073504" "$TOURS_DIR/sydney-to-wollongong/03-grand-pacific-drive.jpg"
get "//xpertmoto.com.au/cdn/shop/files/4-stanwell-tops-lookout-guided-motorcycle-tours-australia.jpg?v=1730073504" "$TOURS_DIR/sydney-to-wollongong/04-stanwell-tops.jpg"
get "//xpertmoto.com.au/cdn/shop/files/5-sea-cliff-bridge-guided-motorcycle-tours-australia.jpg?v=1730073504" "$TOURS_DIR/sydney-to-wollongong/05-sea-cliff-bridge.jpg"
get "//xpertmoto.com.au/cdn/shop/files/6-stuart-park-skydiving-guided-motorcycle-tours-australia.jpg?v=1730073504" "$TOURS_DIR/sydney-to-wollongong/06-stuart-park.jpg"
get "//xpertmoto.com.au/cdn/shop/files/7-wollongong-harbour-guided-motorcycle-tours-australia.jpg?v=1730073504" "$TOURS_DIR/sydney-to-wollongong/07-wollongong-harbour.jpg"
get "//xpertmoto.com.au/cdn/shop/files/8-breakwater-lighthouse-guided-motorcycle-tours-australia.jpg?v=1730073504" "$TOURS_DIR/sydney-to-wollongong/08-breakwater-lighthouse.jpg"
get "//xpertmoto.com.au/cdn/shop/files/9-mount-keira-guided-motorcycle-tours-australia.jpg?v=1730073504" "$TOURS_DIR/sydney-to-wollongong/09-mount-keira.jpg"
get "//xpertmoto.com.au/cdn/shop/files/10-nan-tien-temple-guided-motorcycle-tours-australia.jpg?v=1730073504" "$TOURS_DIR/sydney-to-wollongong/10-nan-tien-temple.jpg"

# Tour 4 — Hunter Valley Loop
mkdir -p "$TOURS_DIR/hunter-valley-loop"
get "//xpertmoto.com.au/cdn/shop/files/1-the-old-road-motorcycle-adventure-tours-australia.jpg?v=1730073322" "$TOURS_DIR/hunter-valley-loop/01-the-old-road.jpg"
get "//xpertmoto.com.au/cdn/shop/files/2-wollombi-road-motorcycle-adventure-tours-australia.jpg?v=1730073322" "$TOURS_DIR/hunter-valley-loop/02-wollombi-road.jpg"
get "//xpertmoto.com.au/cdn/shop/files/3-timber-bridge-crossing-motorcycle-adventure-tours-australia.jpg?v=1730073322" "$TOURS_DIR/hunter-valley-loop/03-timber-bridge.jpg"
get "//xpertmoto.com.au/cdn/shop/files/4-wollomi-national-park-motorcycle-adventure-tours-australia.jpg?v=1730073322" "$TOURS_DIR/hunter-valley-loop/04-wollomi-national-park.jpg"
get "//xpertmoto.com.au/cdn/shop/files/5-lower-hunter-wine-region-motorcycle-adventure-tours-australia.jpg?v=1730073322" "$TOURS_DIR/hunter-valley-loop/05-lower-hunter-wine-region.jpg"
get "//xpertmoto.com.au/cdn/shop/files/6-pokolbin-village-motorcycle-adventure-tours-australia.jpg?v=1730073322" "$TOURS_DIR/hunter-valley-loop/06-pokolbin-village.jpg"
get "//xpertmoto.com.au/cdn/shop/files/7-hunter-valley-gardens-motorcycle-adventure-tours-australia.jpg?v=1730073322" "$TOURS_DIR/hunter-valley-loop/07-hunter-valley-gardens.jpg"
get "//xpertmoto.com.au/cdn/shop/files/8-sackville-ferry-crossing-motorcycle-adventure-tours-australia.jpg?v=1730073322" "$TOURS_DIR/hunter-valley-loop/08-sackville-ferry.jpg"
get "//xpertmoto.com.au/cdn/shop/files/9-yengo-national-park-motorcycle-adventure-tours-australia.jpg?v=1730073322" "$TOURS_DIR/hunter-valley-loop/09-yengo-national-park.jpg"
get "//xpertmoto.com.au/cdn/shop/files/10-putty-road-motorcycle-adventure-tours-australia.jpg?v=1730153080" "$TOURS_DIR/hunter-valley-loop/10-putty-road.jpg"

# Tour 5 — North Coast Ride
mkdir -p "$TOURS_DIR/north-coast-ride"
get "//xpertmoto.com.au/cdn/shop/files/1-wollombi-road-australian-guided-motorcycle-tours.jpg?v=1730073454" "$TOURS_DIR/north-coast-ride/01-wollombi-road.jpg"
get "//xpertmoto.com.au/cdn/shop/files/2-old-pacific-highway-australian-guided-motorcycle-tours.jpg?v=1730073454" "$TOURS_DIR/north-coast-ride/02-old-pacific-highway.jpg"
get "//xpertmoto.com.au/cdn/shop/files/3-mount-tomaree-australian-guided-motorcycle-tours.jpg?v=1730073454" "$TOURS_DIR/north-coast-ride/03-mount-tomaree.jpg"
get "//xpertmoto.com.au/cdn/shop/files/4-zenith-beach-australian-guided-motorcycle-tours.jpg?v=1730073454" "$TOURS_DIR/north-coast-ride/04-zenith-beach.jpg"
get "//xpertmoto.com.au/cdn/shop/files/5-stockton-bridge-australian-guided-motorcycle-tours.jpg?v=1730073454" "$TOURS_DIR/north-coast-ride/05-stockton-bridge.jpg"
get "//xpertmoto.com.au/cdn/shop/files/6-newcastle-australian-guided-motorcycle-tours.jpg?v=1730073454" "$TOURS_DIR/north-coast-ride/06-newcastle.jpg"
get "//xpertmoto.com.au/cdn/shop/files/7-nobbys-lighthouse-australian-guided-motorcycle-tours.jpg?v=1730073455" "$TOURS_DIR/north-coast-ride/07-nobbys-lighthouse.jpg"
get "//xpertmoto.com.au/cdn/shop/files/8-strzelecki-lookout-australian-guided-motorcycle-tours.jpg?v=1730073454" "$TOURS_DIR/north-coast-ride/08-strzelecki-lookout.jpg"
get "//xpertmoto.com.au/cdn/shop/files/9-wisemans-ferry-australian-guided-motorcycle-tours.jpg?v=1730073455" "$TOURS_DIR/north-coast-ride/09-wisemans-ferry.jpg"
get "//xpertmoto.com.au/cdn/shop/files/10-bobbin-head-australian-guided-motorcycle-tours.jpg?v=1730073454" "$TOURS_DIR/north-coast-ride/10-bobbin-head.jpg"

# Tour 6 — Grand Pacific Ride
mkdir -p "$TOURS_DIR/grand-pacific-ride"
get "//xpertmoto.com.au/cdn/shop/files/1-royal-national-park-australian-motorcycle-tours-and-rentals-xpert-moto.jpg?v=1730073228" "$TOURS_DIR/grand-pacific-ride/01-royal-national-park.jpg"
get "//xpertmoto.com.au/cdn/shop/files/2-grand-pacific-drive-australian-motorcycle-tours-and-rentals-xpert-moto.jpg?v=1730073228" "$TOURS_DIR/grand-pacific-ride/02-grand-pacific-drive.jpg"
get "//xpertmoto.com.au/cdn/shop/files/3-wollongong-harbour-australian-motorcycle-tours-and-rentals-xpert-moto.jpg?v=1730073228" "$TOURS_DIR/grand-pacific-ride/03-wollongong-harbour.jpg"
get "//xpertmoto.com.au/cdn/shop/files/4-breakwater-lighthouse-australian-motorcycle-tours-and-rentals-xpert-moto.jpg?v=1730073228" "$TOURS_DIR/grand-pacific-ride/04-breakwater-lighthouse.jpg"
get "//xpertmoto.com.au/cdn/shop/files/5-illawarra-loop-australian-motorcycle-tours-and-rentals-xpert-moto.jpg?v=1730073228" "$TOURS_DIR/grand-pacific-ride/05-illawarra-loop.jpg"
get "//xpertmoto.com.au/cdn/shop/files/6-macquarie-pass-ntl-park-australian-motorcycle-tours-and-rentals-xpert-moto.jpg?v=1730073228" "$TOURS_DIR/grand-pacific-ride/06-macquarie-pass.jpg"
get "//xpertmoto.com.au/cdn/shop/files/7-fitzroy-falls-australian-motorcycle-tours-and-rentals-xpert-moto.jpg?v=1730073228" "$TOURS_DIR/grand-pacific-ride/07-fitzroy-falls.jpg"
get "//xpertmoto.com.au/cdn/shop/files/8-kangaroo-valley-australian-motorcycle-tours-and-rentals-xpert-moto.jpg?v=1730073228" "$TOURS_DIR/grand-pacific-ride/08-kangaroo-valley.jpg"
get "//xpertmoto.com.au/cdn/shop/files/9-cambewarra-lookout-australian-motorcycle-tours-and-rentals-xpert-moto.jpg?v=1730073227" "$TOURS_DIR/grand-pacific-ride/09-cambewarra-lookout.jpg"
get "//xpertmoto.com.au/cdn/shop/files/10-kiama-light-and-blowhole-australian-motorcycle-tours-and-rentals-xpert-moto.jpg?v=1730073228" "$TOURS_DIR/grand-pacific-ride/10-kiama-light.jpg"

# Tour 7 — Twisty & Touristic
mkdir -p "$TOURS_DIR/twisty-and-touristic"
get "//xpertmoto.com.au/cdn/shop/files/1-hawkings-lookout-tours-motorcycle-australia-sydney.jpg?v=1730214986" "$TOURS_DIR/twisty-and-touristic/01-hawkings-lookout.jpg"
get "//xpertmoto.com.au/cdn/shop/files/2-wisemans-village-tours-motorcycle-australia-sydney.jpg?v=1730214986" "$TOURS_DIR/twisty-and-touristic/02-wisemans-village.jpg"
get "//xpertmoto.com.au/cdn/shop/files/3-webbs-creek-ferry-tours-motorcycle-australia-sydney.jpg?v=1730214985" "$TOURS_DIR/twisty-and-touristic/03-webbs-creek-ferry.jpg"
get "//xpertmoto.com.au/cdn/shop/files/4-saint-albans-tours-motorcycle-australia-sydney.jpg?v=1730214986" "$TOURS_DIR/twisty-and-touristic/04-saint-albans.jpg"
get "//xpertmoto.com.au/cdn/shop/files/5-hawkesburry-river-tours-motorcycle-australia-sydney.jpg?v=1730214986" "$TOURS_DIR/twisty-and-touristic/05-hawkesbury-river.jpg"
get "//xpertmoto.com.au/cdn/shop/files/6-old-pacific-highway-tours-motorcycle-australia-sydney.jpg?v=1730214986" "$TOURS_DIR/twisty-and-touristic/06-old-pacific-highway.jpg"
get "//xpertmoto.com.au/cdn/shop/files/7-bobbin-head-tours-motorcycle-australia-sydney.jpg?v=1730214986" "$TOURS_DIR/twisty-and-touristic/07-bobbin-head.jpg"
get "//xpertmoto.com.au/cdn/shop/files/8-sphinx-memorial-tours-motorcycle-australia-sydney.jpg?v=1730214986" "$TOURS_DIR/twisty-and-touristic/08-sphinx-memorial.jpg"
get "//xpertmoto.com.au/cdn/shop/files/9-ku-ring-gai-national-park-tours-motorcycle-australia-sydney.jpg?v=1730214986" "$TOURS_DIR/twisty-and-touristic/09-ku-ring-gai.jpg"
get "//xpertmoto.com.au/cdn/shop/files/10-church-point-tours-motorcycle-australia-sydney.jpg?v=1730214986" "$TOURS_DIR/twisty-and-touristic/10-church-point.jpg"

# Mechanic — repair photos
get "//xpertmoto.com.au/cdn/shop/files/repair1.png?v=1774480994"  "$MECH_DIR/repair1.png"
get "//xpertmoto.com.au/cdn/shop/files/repair3.png?v=1774480994"  "$MECH_DIR/repair3.png"
get "//xpertmoto.com.au/cdn/shop/files/repair4.png?v=1774480994"  "$MECH_DIR/repair4.png"
get "//xpertmoto.com.au/cdn/shop/files/repair6.png?v=1774480994"  "$MECH_DIR/repair6.png"
get "//xpertmoto.com.au/cdn/shop/files/repair7.png?v=1774480994"  "$MECH_DIR/repair7.png"
get "//xpertmoto.com.au/cdn/shop/files/repair8.png?v=1774480994"  "$MECH_DIR/repair8.png"
get "//xpertmoto.com.au/cdn/shop/files/repair9.png?v=1774480994"  "$MECH_DIR/repair9.png"
get "//xpertmoto.com.au/cdn/shop/files/repair10.png?v=1774480994" "$MECH_DIR/repair10.png"
get "//xpertmoto.com.au/cdn/shop/files/repair11.png?v=1774480993" "$MECH_DIR/repair11.png"
get "//xpertmoto.com.au/cdn/shop/files/repair12.png?v=1774480994" "$MECH_DIR/repair12.png"

# Mechanic — brand logos
get "//xpertmoto.com.au/cdn/shop/files/kawasaki.jpg?v=1774955220"     "$BRANDS_DIR/kawasaki.jpg"
get "//xpertmoto.com.au/cdn/shop/files/cfmoto.png?v=1774954183"       "$BRANDS_DIR/cfmoto.png"
get "//xpertmoto.com.au/cdn/shop/files/suzuki.jpg?v=1774955146"       "$BRANDS_DIR/suzuki.jpg"
get "//xpertmoto.com.au/cdn/shop/files/royal_enfield.jpg?v=1774955169" "$BRANDS_DIR/royal-enfield.jpg"
get "//xpertmoto.com.au/cdn/shop/files/triumph.png?v=1774954140"      "$BRANDS_DIR/triumph.png"
get "//xpertmoto.com.au/cdn/shop/files/ducati.png?v=1774941169"       "$BRANDS_DIR/ducati.png"
get "//xpertmoto.com.au/cdn/shop/files/ktm.png?v=1774941148"          "$BRANDS_DIR/ktm.png"
get "//xpertmoto.com.au/cdn/shop/files/honda.png?v=1774941085"        "$BRANDS_DIR/honda.png"
get "//xpertmoto.com.au/cdn/shop/files/yamaha.png?v=1774941107"       "$BRANDS_DIR/yamaha.png"
get "//xpertmoto.com.au/cdn/shop/files/bmw2.png?v=1774949379"         "$BRANDS_DIR/bmw.png"

echo "✔ All XPERT images downloaded."
