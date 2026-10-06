import assert from "node:assert/strict";
import test from "node:test";
import { cleanMerchantName, vendorKey, vendorsMatch } from "./merchant-name.ts";

// The three real descriptions this was written for.
test("a masked card number is stripped: ROGERS *************3771", () => {
  assert.equal(cleanMerchantName("ROGERS *************3771"), "Rogers");
});

test("a trailing city is stripped: TELUS MOBILITY EDMONTON", () => {
  assert.equal(cleanMerchantName("TELUS MOBILITY EDMONTON"), "Telus Mobility");
});

test("a phone number is stripped: CANADA SPORTSWEAR CORP 416-7408020", () => {
  assert.equal(cleanMerchantName("CANADA SPORTSWEAR CORP 416-7408020"), "Canada Sportswear Corp");
});

// Phone formats
test("phone numbers are stripped in every common format", () => {
  for (const phone of ["416-740-8020", "(416) 740-8020", "416.740.8020", "4167408020", "1-800-555-1234", "+1 416 740 8020"]) {
    assert.equal(cleanMerchantName(`ACME SUPPLY ${phone}`), "Acme Supply", phone);
  }
});

test("a phone number in the middle is removed without gluing the words together", () => {
  assert.equal(cleanMerchantName("ACME 416-740-8020 SUPPLY"), "Acme Supply");
});

// Masks
test("other mask styles are stripped: bullets, X's, and short asterisk runs", () => {
  assert.equal(cleanMerchantName("ROGERS ••••3771"), "Rogers");
  assert.equal(cleanMerchantName("ROGERS XXXX3771"), "Rogers");
  assert.equal(cleanMerchantName("ROGERS **3771"), "Rogers");
  assert.equal(cleanMerchantName("ROGERS ************* 3771"), "Rogers");
});

test("a lone asterisk is a processor separator: the merchant after it is kept", () => {
  assert.equal(cleanMerchantName("SQ *COFFEE SHOP"), "Sq Coffee Shop");
  assert.equal(cleanMerchantName("PAYPAL *ACMETOOLS"), "Paypal Acmetools");
});

// Locations
test("a trailing province code and city are both stripped", () => {
  assert.equal(cleanMerchantName("HOME DEPOT TORONTO ON"), "Home Depot");
  assert.equal(cleanMerchantName("SHELL OIL 76 MISSISSAUGA ON"), "Shell Oil 76");
  assert.equal(cleanMerchantName("TIM HORTONS CALGARY AB"), "Tim Hortons");
});

test("multi-word cities are stripped whole", () => {
  assert.equal(cleanMerchantName("CANADIAN TIRE NORTH YORK ON"), "Canadian Tire");
  assert.equal(cleanMerchantName("ESSO SAULT STE MARIE"), "Esso");
  assert.equal(cleanMerchantName("STAPLES RICHMOND HILL"), "Staples");
});

test("a city that is part of the name (after 'of') is kept", () => {
  assert.equal(cleanMerchantName("BANK OF MONTREAL"), "Bank of Montreal");
  assert.equal(cleanMerchantName("UNIVERSITY OF TORONTO"), "University of Toronto");
  assert.equal(cleanMerchantName("CITY OF HAMILTON"), "City of Hamilton");
  // ...and still correct when a real location follows it.
  assert.equal(cleanMerchantName("BANK OF MONTREAL TORONTO ON"), "Bank of Montreal");
});

test("a city at the START of the name is never stripped", () => {
  assert.equal(cleanMerchantName("LONDON DRUGS"), "London Drugs");
  assert.equal(cleanMerchantName("TORONTO HYDRO"), "Toronto Hydro");
});

test("an unlisted city is left alone rather than guessed at", () => {
  assert.equal(cleanMerchantName("HARDWARE SHOP TILLSONBURGH"), "Hardware Shop Tillsonburgh");
});

test("a name that is only a city is kept (never emptied)", () => {
  assert.equal(cleanMerchantName("EDMONTON"), "Edmonton");
  assert.equal(cleanMerchantName("TORONTO ON"), "Toronto");
});

// Things that must survive
test("store numbers are kept - they tell two branches apart", () => {
  assert.equal(cleanMerchantName("HOME DEPOT #7042 TORONTO ON"), "Home Depot #7042");
  assert.equal(cleanMerchantName("TIM HORTONS #221"), "Tim Hortons #221");
});

test("a short digit group that is not a phone number is kept", () => {
  assert.equal(cleanMerchantName("SHELL OIL 76"), "Shell Oil 76");
  assert.equal(cleanMerchantName("ROUTE 66 DINER"), "Route 66 Diner");
});

// Casing
test("ALL CAPS is re-cased; initialisms and stylised brands stay upper", () => {
  assert.equal(cleanMerchantName("LCBO"), "LCBO");
  assert.equal(cleanMerchantName("TD CANADA TRUST"), "TD Canada Trust");
  assert.equal(cleanMerchantName("KFC"), "KFC");
  assert.equal(cleanMerchantName("A&W RESTAURANTS"), "A&W Restaurants");
  assert.equal(cleanMerchantName("H&M"), "H&M");
});

test("apostrophes, hyphens and dots are cased sensibly", () => {
  assert.equal(cleanMerchantName("TIM HORTON'S"), "Tim Horton's");
  assert.equal(cleanMerchantName("COCA-COLA BOTTLING"), "Coca-Cola Bottling");
  assert.equal(cleanMerchantName("AMAZON.CA"), "Amazon.ca");
});

test("text that already has lowercase letters keeps the issuer's casing", () => {
  assert.equal(cleanMerchantName("McDonald's #4021"), "McDonald's #4021");
  assert.equal(cleanMerchantName("Rogers *************3771"), "Rogers");
});

// Robustness
test("whitespace and stray separators are tidied", () => {
  assert.equal(cleanMerchantName("  ROGERS   -  "), "Rogers");
  assert.equal(cleanMerchantName("ACME  SUPPLY ,"), "Acme Supply");
});

test("a description that is only noise falls back to the original text, never to nothing", () => {
  assert.equal(cleanMerchantName("*************3771"), "*************3771");
  assert.equal(cleanMerchantName("416-7408020"), "416-7408020");
});

test("'of', 'the' and 'and' stay lowercase inside a name but not at the start", () => {
  assert.equal(cleanMerchantName("THE BAY"), "The Bay");
  assert.equal(cleanMerchantName("HARRY AND DAVID"), "Harry and David");
  assert.equal(cleanMerchantName("HOUSE OF TOOLS"), "House of Tools");
});

test("empty and whitespace-only input give an empty string", () => {
  assert.equal(cleanMerchantName(""), "");
  assert.equal(cleanMerchantName("   "), "");
});

test("it is idempotent: cleaning a cleaned name changes nothing", () => {
  for (const raw of ["ROGERS *************3771", "TELUS MOBILITY EDMONTON", "CANADA SPORTSWEAR CORP 416-7408020", "HOME DEPOT #7042 TORONTO ON"]) {
    const once = cleanMerchantName(raw);
    assert.equal(cleanMerchantName(once), once, raw);
  }
});

test("the result never exceeds the 200 character limit", () => {
  assert.ok(cleanMerchantName("A".repeat(500)).length <= 200);
});

// ---------------------------------------------------------------------------
// vendorKey / vendorsMatch: "is this the same vendor?"
// ---------------------------------------------------------------------------

test("vendorKey: the noise around one vendor collapses to one key", () => {
  for (const raw of ["ROGERS *************3771", "Rogers Communications Canada Inc.", "ROGERS", "rogers communications"]) {
    assert.equal(vendorKey(raw), "rogers", raw);
  }
  assert.equal(vendorKey("HOME DEPOT #7042 TORONTO ON"), "home depot");
  assert.equal(vendorKey("HOME DEPOT #7013 MISSISSAUGA ON"), "home depot");
  assert.equal(vendorKey("Home Depot of Canada Inc"), "home depot");
});

test("vendorKey: apostrophes, dots, ampersands and case don't matter", () => {
  assert.equal(vendorKey("TIM HORTON'S"), vendorKey("Tim Hortons"));
  assert.equal(vendorKey("A&W RESTAURANTS"), vendorKey("A & W Restaurants"));
  assert.equal(vendorKey("Amazon.ca"), vendorKey("AMAZON.CA"));
});

test("vendorKey: a transaction reference after a lone * is dropped, but a name after it is kept", () => {
  assert.equal(vendorKey("AMZN MKTP CA*2K4QX7"), "amzn mktp ca");
  assert.equal(vendorKey("AMZN MKTP CA*9ZT3L1"), "amzn mktp ca");
  assert.equal(vendorKey("SQ *COFFEE SHOP"), "sq coffee shop");
});

test("vendorKey: only trailing generic words go, and never the last word left", () => {
  assert.equal(vendorKey("Canada Post"), "canada post");
  assert.equal(vendorKey("Canada"), "canada");
  assert.equal(vendorKey("Acme Services Group Inc."), "acme");
  assert.equal(vendorKey("Shell Energy"), "shell energy");
});

test("vendorKey: nothing to key on gives null", () => {
  assert.equal(vendorKey(""), null);
  assert.equal(vendorKey("   "), null);
  assert.equal(vendorKey(null), null);
  assert.equal(vendorKey(undefined), null);
});

test("vendorsMatch: Rogers on an invoice is the Rogers on the card statement", () => {
  assert.equal(vendorsMatch("Rogers Communications Canada Inc.", "ROGERS *************3771"), true);
});

test("vendorsMatch: look-alike vendors are NOT the same vendor", () => {
  assert.equal(vendorsMatch("Shell", "Shell Energy"), false);
  assert.equal(vendorsMatch("Home Depot", "Home Hardware"), false);
  assert.equal(vendorsMatch("Bell Canada", "Bell Mobility"), false);
  assert.equal(vendorsMatch("Canadian Tire", "Canadian Tire Gas Bar"), false);
});

test("vendorsMatch: needs a vendor on both sides", () => {
  assert.equal(vendorsMatch("Rogers", ""), false);
  assert.equal(vendorsMatch(null, null), false);
  assert.equal(vendorsMatch(undefined, "Rogers"), false);
});

test("vendorsMatch is symmetric", () => {
  const pairs: [string, string][] = [["Rogers Communications", "ROGERS"], ["Shell", "Shell Energy"], ["TIM HORTONS #221", "Tim Hortons"]];
  for (const [a, b] of pairs) assert.equal(vendorsMatch(a, b), vendorsMatch(b, a), a + " / " + b);
});
