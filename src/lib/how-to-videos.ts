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
];
