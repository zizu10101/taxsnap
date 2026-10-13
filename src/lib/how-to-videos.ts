// Every demo video on the site, in one place: the /how-to index, the
// /how-to/<slug> pages, the sitemap and the homepage tab all read this list.
// Adding a video = add an entry here and drop its mp4 + poster in public/videos/
// (`npm run videos:encode`). An entry whose mp4 is missing, or that is `hidden`,
// is left out everywhere (see how-to-videos-server.ts).
export interface HowToVideo {
  /** URL segment: /how-to/<slug>. */
  slug: string;
  title: string;
  /** One line, shown on the index card and the page. */
  description: string;
  /** Short numbered steps (3-5), written from the video's captions. */
  steps: string[];
  mp4: string;
  poster: string;
  /** Omit from the index, the routes and the sitemap. */
  hidden?: boolean;
  /** Also show it as a tab in the homepage's "See it in action". */
  showcase?: { label: string; title: string; description: string };
}

export const HOW_TO_VIDEOS: HowToVideo[] = [
  {
    slug: "estimate-to-invoice",
    title: "Turn an estimate into an invoice",
    description: "Create an estimate, add your work, and convert it to an invoice.",
    steps: [
      "Start a new estimate.",
      "Pick your client.",
      "Add your work: a name, a description, the quantity, the unit and the price for each line.",
      "Create the estimate.",
      "Tap Convert to Invoice once the client has approved it.",
    ],
    mp4: "/videos/estimate-to-invoice.mp4",
    poster: "/videos/estimate-to-invoice.jpg",
    showcase: {
      label: "Estimate to invoice",
      title: "From estimate to invoice in a minute",
      description: "Pick your client, add your work, and turn the approved estimate into an invoice.",
    },
  },
  {
    slug: "job-photos",
    title: "Add photos to a job",
    description: "Create a job and attach site photos from your phone.",
    steps: [
      "Create a job with a name, a location and the client.",
      "Tap Add photos and choose your pictures. They are shrunk on your phone before they upload.",
      "Upload them. Each photo is filed under the job.",
      "Tap any photo to see it full size.",
      "Open the job any time to find all of its photos in one place.",
    ],
    mp4: "/videos/job-photos.mp4",
    poster: "/videos/job-photos.jpg",
  },
  {
    slug: "record-payment",
    title: "Record a deposit and get paid in full",
    description: "Log a deposit on an invoice, then collect the remaining balance.",
    steps: [
      "Open your invoice.",
      "Record a deposit: the amount, the date and how it was paid.",
      "Tap Collect remaining balance to fill in what is still owing, then record it.",
      "The invoice shows Paid in full, and the payments are counted in your HST.",
    ],
    mp4: "/videos/record-payment.mp4",
    poster: "/videos/record-payment.jpg",
  },
  {
    slug: "job-profit",
    title: "See what a job really made you",
    description: "Add a job's costs, get paid, and see your profit on the job.",
    steps: [
      "Create a job for your client.",
      "Add your costs, like lumber and hardware, and tag them to the job.",
      "Create an invoice for the job and record the payment you receive.",
      "Open the job to see its revenue, its costs and your real profit.",
    ],
    mp4: "/videos/job-profit.mp4",
    poster: "/videos/job-profit.jpg",
  },
  {
    slug: "record-esign",
    title: "Get an estimate signed online",
    description: "Send your client a link, let them sign on their phone, then invoice the approved estimate.",
    steps: [
      "Create your estimate: pick the client and add your work.",
      "Send the link: tap Send, then Copy link, and pass it to your client.",
      "Your client opens the link on their phone, reads the estimate and signs it.",
      "The estimate shows as signed. Open the invoice made from it.",
    ],
    mp4: "/videos/record-esign.mp4",
    poster: "/videos/record-esign.jpg",
  },
  {
    slug: "record-progress-billing",
    title: "Bill a big job in stages",
    description: "Set a contract value, then bill it in draws and see what is still owed.",
    steps: [
      "Set the contract: start progress billing with the job and its total value.",
      "Bill the first draw, for example 30% of the contract.",
      "Bill the next draw, for example 40% more.",
      "See what you have invoiced, what you have received and what is still owed against the contract.",
    ],
    mp4: "/videos/record-progress-billing.mp4",
    poster: "/videos/record-progress-billing.jpg",
  },
  {
    slug: "record-reports",
    title: "Check your revenue, expenses and HST",
    description: "Pick a date range and read your reports for that period.",
    steps: [
      "Open Reports and pick your dates.",
      "Read Revenue by client.",
      "See your expenses by category, or switch to vendor.",
      "Open the HST Return Helper to know what you owe or can claim.",
    ],
    mp4: "/videos/record-reports.mp4",
    poster: "/videos/record-reports.jpg",
    hidden: true, // until the recording has been watched
  },
  {
    slug: "record-receipt-scan",
    title: "Scan a receipt",
    description: "Upload a receipt and let the AI read the merchant, tax and category for you.",
    steps: [
      "Tap Scan Receipt and snap a photo, or upload one from your phone.",
      "The AI reads the receipt in a few seconds.",
      "The merchant, total, tax and category are filled in. Fix anything that looks off.",
      "Save it. It is counted in your HST right away.",
    ],
    mp4: "/videos/record-receipt-scan.mp4",
    poster: "/videos/record-receipt-scan.jpg",
    hidden: true, // until the recording has been watched
  },
];
