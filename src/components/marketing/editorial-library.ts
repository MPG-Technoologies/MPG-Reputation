export type EditorialArticle = {
  slug: string;
  category: string;
  title: string;
  summary: string;
  sections: {
    heading: string;
    paragraphs: string[];
  }[];
};

export const EDITORIAL_ARTICLES: EditorialArticle[] = [
  {
    slug: "a-repeatable-review-request-workflow",
    category: "Process Design",
    title: "Build a repeatable review-request workflow",
    summary: "A practical approach to requesting honest reviews after genuine completed services.",
    sections: [
      {
        heading: "Start with a completed service",
        paragraphs: [
          "A review-request process begins with a real customer interaction. Record when the service was completed and which location provided it.",
          "MPG Reputation provides Quick Complete and signed completion-source interfaces for this operational workflow."
        ]
      },
      {
        heading: "Use consistent eligibility rules",
        paragraphs: [
          "Before preparing a request, evaluate customer communication preferences, duplicate requests and applicable suppression rules.",
          "Apply a neutral approach to eligible customers rather than selecting only customers expected to leave positive reviews."
        ]
      },
      {
        heading: "Invite honest feedback",
        paragraphs: [
          "A review request is an invitation. Customers independently decide whether to open the review destination and publish feedback.",
          "MPG Reputation does not guarantee positive reviews or published Google reviews."
        ]
      },
      {
        heading: "Measure what you can verify",
        paragraphs: [
          "Track recorded completions, eligible requests and available workflow outcomes. A tracked click does not prove that a review was published."
        ]
      }
    ]
  },
  {
    slug: "understanding-review-request-activity",
    category: "Measurement",
    title: "Understanding review-request activity",
    summary: "Learn the difference between service completions, requests, message delivery and published reviews.",
    sections: [
      {
        heading: "A completion is not a review",
        paragraphs: [
          "Recording a completed service does not mean a customer has received a review request or published a review."
        ]
      },
      {
        heading: "Eligibility is not delivery",
        paragraphs: [
          "An eligible review request can still be awaiting dispatch. A successful Quick Complete receipt must not be presented as proof of email delivery.",
          "Live customer messaging remains inactive during the current prelaunch development stage."
        ]
      },
      {
        heading: "Clicks are not published reviews",
        paragraphs: [
          "A tracked link click shows that the destination was opened. It does not establish that a customer submitted a review or that Google published it."
        ]
      },
      {
        heading: "Report honestly",
        paragraphs: [
          "Use activity information to improve follow-up consistency without making unsupported claims about review growth.",
          "The proposed 30 Free Review Requests allowance refers to review requests, not 30 published reviews."
        ]
      }
    ]
  }
];

export function findEditorialArticle(slug: string) {
  return EDITORIAL_ARTICLES.find(article => article.slug === slug);
}