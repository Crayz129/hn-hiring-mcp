import { describe, expect, it } from "vitest";
import { htmlToText } from "../src/html.ts";
import { parseHiringThreadTitle, parseJobPost, redactEmails } from "../src/parse.ts";
import { canonicalTechnology, detectTechnologies } from "../src/technologies.ts";

const post = (text: string | null) => parseJobPost({ id: 7, created_at: "2026-10-01T15:00:00.000Z", text }, 1, "2026-10");

describe("htmlToText", () => {
  it("decodes entities, keeps paragraphs and collects links", () => {
    const { text, links } = htmlToText(
      'Acme &amp; Co | Engineer<p>Apply at <a href="https:&#x2F;&#x2F;acme.dev&#x2F;jobs" rel="nofollow">https:&#x2F;&#x2F;acme.dev&#x2F;jobs</a> &#x27;now&#x27;',
    );
    expect(text).toBe("Acme & Co | Engineer\n\nApply at https://acme.dev/jobs 'now'");
    expect(links).toEqual(["https://acme.dev/jobs"]);
  });
});

describe("parseHiringThreadTitle", () => {
  it("extracts the month of hiring threads only", () => {
    expect(parseHiringThreadTitle("Ask HN: Who is hiring? (October 2026)")).toBe("2026-10");
    expect(parseHiringThreadTitle("Ask HN: Who is hiring? (March 2019)")).toBe("2019-03");
    expect(parseHiringThreadTitle("Ask HN: Who wants to be hired? (October 2026)")).toBeNull();
    expect(parseHiringThreadTitle("Ask HN: Freelancer? Seeking Freelancer? (October 2026)")).toBeNull();
  });
});

describe("parseJobPost", () => {
  it("parses the conventional pipe-separated headline", () => {
    const p = post(
      "Sidekick Labs | Senior SWE, R&amp;D Engineer | REMOTE (US Timezones) | Full-time | $170k to $230k Base + Equity<p>We use Python, Go, and PostgreSQL on AWS.",
    )!;
    expect(p.company).toBe("Sidekick Labs");
    expect(p.roles).toEqual(["Senior SWE, R&D Engineer"]);
    expect(p.location).toBe("REMOTE (US Timezones)");
    expect(p.workModes).toEqual(["remote"]);
    expect(p.employmentTypes).toEqual(["full-time"]);
    expect(p.salary).toBe("$170k to $230k Base + Equity");
    expect(p.technologies).toEqual(expect.arrayContaining(["Python", "Go", "PostgreSQL", "AWS"]));
    expect(p.hnUrl).toBe("https://news.ycombinator.com/item?id=7");
  });

  it("handles em-dash headlines with the location in parentheses", () => {
    const p = post("PrairieLearn (Remote US) — Full-Stack Software Engineer — TypeScript &#x2F; Postgres<p>Body")!;
    expect(p.company).toBe("PrairieLearn");
    expect(p.roles).toEqual(["Full-Stack Software Engineer"]);
    expect(p.location).toBe("Remote US; TypeScript / Postgres");
    expect(p.workModes).toEqual(["remote"]);
  });

  it("does not split salary ranges written with ' - '", () => {
    const p = post("SerpApi | Engineer | ONSITE or FULLY REMOTE | $150K - 180K a year<p>Body")!;
    expect(p.salary).toBe("$150K - 180K a year");
    expect(p.workModes).toEqual(["remote", "onsite"]);
  });

  it("keeps URLs out of location and role fields", () => {
    const p = post("3Gimbals | Engineer | https:&#x2F;&#x2F;www.linkedin.com&#x2F;jobs&#x2F;view&#x2F;1 (US&#x2F;Remote) | acme.dev<p>Body")!;
    expect(p.location).toBe("(US/Remote)");
    expect(p.workModes).toEqual(["remote"]);
  });

  it("finds a salary in the body when the headline has none", () => {
    expect(post("Acme | Engineer | Berlin<p>Pay: €80k–€95k plus equity.")!.salary).toBe("€80k–€95k");
    expect(post("Acme | Engineer | Berlin<p>We raised $5 million.")!.salary).toBeNull();
  });

  it("falls back to shouted work-mode tokens in the body, ignoring casual mentions", () => {
    expect(post("Acme | Engineer<p>Location: HYBRID in Austin")!.workModes).toEqual(["hybrid"]);
    expect(post("Acme | Engineer<p>We have remote colleagues.")!.workModes).toEqual([]);
  });

  it("classifies visa sponsorship as yes / no / not mentioned", () => {
    expect(post("Acme | Engineer<p>Visa sponsorship available.")!.visaSponsorship).toBe(true);
    expect(post("Acme | Engineer | REMOTE (US only; no visa sponsorship)<p>x")!.visaSponsorship).toBe(false);
    expect(post("Acme | Engineer<p>We are unable to sponsor visas.")!.visaSponsorship).toBe(false);
    expect(post("Acme | Engineer<p>Nothing here.")!.visaSponsorship).toBeNull();
  });

  it("redacts e-mail addresses in text and headline", () => {
    const p = post("Acme | Engineer | jobs@acme.dev<p>Write to jane.doe+hn@acme.co.uk or bob [at] acme [dot] com")!;
    expect(p.headline).not.toContain("@");
    expect(p.text).toBe("Acme | Engineer | [email on HN]\n\nWrite to [email on HN] or [email on HN]");
  });

  it("returns null for deleted posts", () => {
    expect(post(null)).toBeNull();
    expect(post("")).toBeNull();
  });
});

describe("redactEmails", () => {
  it("covers puzzle-style addresses but leaves social handles alone", () => {
    expect(redactEmails("mail 'jane@' + 'acme.dev'")).toBe("mail '[email on HN]' + 'acme.dev'");
    expect(redactEmails("https://youtube.com/@acme")).toBe("https://youtube.com/@acme");
  });
});

describe("technologies", () => {
  it("does not mistake English 'Go' or JavaScript for languages", () => {
    expect(detectTechnologies("Go ahead and apply. We use JavaScript.")).toEqual(["JavaScript"]);
    expect(detectTechnologies("Stack: Python, Go, Rust")).toEqual(["Python", "Go", "Rust"]);
    expect(detectTechnologies("Golang and Java services")).toEqual(["Go", "Java"]);
  });

  it("normalises aliases and rejects unknown names", () => {
    expect(canonicalTechnology("golang")).toBe("Go");
    expect(canonicalTechnology("Postgres")).toBe("PostgreSQL");
    expect(canonicalTechnology(" k8s ")).toBe("Kubernetes");
    expect(canonicalTechnology("cobol")).toBeUndefined();
  });
});
