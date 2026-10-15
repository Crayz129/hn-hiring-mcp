import { htmlToText } from "./html.ts";
import { detectTechnologies } from "./technologies.ts";

export type WorkMode = "remote" | "hybrid" | "onsite";
export type EmploymentType = "full-time" | "part-time" | "contract" | "internship";

export interface JobPost {
  id: number;
  threadId: number;
  /** Month of the thread, YYYY-MM. */
  month: string;
  postedAt: string;
  /** First line of the post, where HN convention puts "Company | Role | Location | ...". */
  headline: string;
  company: string;
  roles: string[];
  location: string | null;
  workModes: WorkMode[];
  employmentTypes: EmploymentType[];
  /** Salary as written by the poster, e.g. "$170k to $230k Base + Equity". */
  salary: string | null;
  /** true: sponsorship offered, false: explicitly not offered, null: not mentioned. */
  visaSponsorship: boolean | null;
  technologies: string[];
  links: string[];
  /** Post body with e-mail addresses redacted. */
  text: string;
  hnUrl: string;
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** "Ask HN: Who is hiring? (October 2026)" -> "2026-10"; other titles -> null. */
export function parseHiringThreadTitle(title: string): string | null {
  const m = /^Ask HN: Who is hiring\?\s*\((\w+)\s+(\d{4})\)/i.exec(title);
  if (!m) return null;
  const monthIndex = MONTHS.indexOf(m[1]!.toLowerCase());
  if (monthIndex < 0) return null;
  return `${m[2]}-${String(monthIndex + 1).padStart(2, "0")}`;
}

export const hnItemUrl = (id: number) => `https://news.ycombinator.com/item?id=${id}`;

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// Puzzle-style addresses: "'jane@' + domain".
const EMAIL_FRAGMENT_RE = /[\w.+-]+@(?![\w-])/g;
// Obfuscated forms: "jane [at] acme [dot] com", "jane at acme dot com".
const OBFUSCATED_EMAIL_RE = /[\w.+-]+\s*(?:\[\s*at\s*\]|\(\s*at\s*\)|\s+at\s+)\s*[\w-]+\s*(?:(?:\[\s*dot\s*\]|\(\s*dot\s*\)|\s+dot\s+)\s*[\w-]+)+/gi;

/** Contact e-mails belong to individual people; we point to the HN post instead of repeating them. */
export function redactEmails(text: string): string {
  return text
    .replace(EMAIL_RE, "[email on HN]")
    .replace(EMAIL_FRAGMENT_RE, "[email on HN]")
    .replace(OBFUSCATED_EMAIL_RE, "[email on HN]");
}

const SEPARATOR_RE = /\s+[|—–]\s+|\s*\|\s*|\s+-\s+(?![$€£]?\d)/;
const URL_FIELD_RE = /^(?:https?:\/\/)?[\w-]+(?:\.[\w-]+)+(?:\/\S*)?$/i;
const SALARY_RE = /[$€£]\s?\d|\d\s?[kK]\s*(?:[-–]|to|\+)|\b\d{2,3}\s?[kK]\b|\b(?:USD|EUR|GBP|CHF|CAD|AUD)\b|\bsalary\b/;
const ROLE_RE = /\b(?:engineers?|developers?|scientists?|designers?|managers?|leads?|head of|architects?|analysts?|researchers?|sre|devops|interns?|directors?|cto|vp|product|founding|staff|principal|roles|positions|openings|recruiters?|specialists?|consultants?|administrators?|marketers?|marketing|sales|account executives?|writers?|operations|ops|hiring|swe|mle|ml|data)\b/i;
const EMPLOYMENT_PATTERNS: ReadonlyArray<readonly [EmploymentType, RegExp]> = [
  ["full-time", /\bfull[\s-]?time\b|\bFT\b/i],
  ["part-time", /\bpart[\s-]?time\b/i],
  ["contract", /\bcontract(?:or)?\b|\bfreelance\b/i],
  ["internship", /\bintern(?:ship)?s?\b/i],
];
const MODE_PATTERNS: ReadonlyArray<readonly [WorkMode, RegExp]> = [
  ["remote", /\bremote\b/i],
  ["hybrid", /\bhybrid\b/i],
  ["onsite", /\bon[\s-]?site\b|\bin[\s-]office\b|\bin[\s-]person\b/i],
];
const BARE_FIELD_RE = /^(?:remote|hybrid|on[\s-]?site|in[\s-]office|full[\s-]?time|part[\s-]?time|contract|internship|ft)$/i;
const VISA_NO_RE = /\bno visa\b|\b(?:not|cannot|can't|unable to|don't|do not|won't)\s+(?:\w+\s+){0,2}sponsor|\bwithout (?:visa )?sponsorship\b|\bno sponsorship\b/i;
const VISA_YES_RE = /\bvisa\b|\bsponsor(?:ship)?\b|\bh-?1b\b|\brelocation\b/i;

function stripParentheticals(s: string): string {
  return s.replace(/\s*\([^)]*\)/g, "").replace(/\s*https?:\/\/\S+/g, "").trim();
}

function detectAll<T>(patterns: ReadonlyArray<readonly [T, RegExp]>, text: string): T[] {
  return patterns.filter(([, re]) => re.test(text)).map(([value]) => value);
}

export interface RawComment {
  id: number;
  created_at: string;
  text: string | null;
}

/** Parses one top-level comment of a "Who is hiring?" thread; returns null for deleted/empty posts. */
export function parseJobPost(raw: RawComment, threadId: number, month: string): JobPost | null {
  if (!raw.text) return null;
  const firstParagraph = raw.text.split(/<p>/i)[0] ?? "";
  const { text, links } = htmlToText(raw.text);
  const headline = htmlToText(firstParagraph).text.replace(/\s+/g, " ").trim();
  if (!headline) return null;

  const fields = headline.split(SEPARATOR_RE).map((f) => f.trim()).filter(Boolean);
  const [companyField = headline, ...rest] = fields;
  const roles: string[] = [];
  const locationParts: string[] = [];
  let salary: string | null = null;

  for (const rawField of rest) {
    if (URL_FIELD_RE.test(rawField)) continue;
    const field = rawField.replace(/https?:\/\/\S+/g, "").trim();
    if (!field) continue;
    if (!salary && SALARY_RE.test(field)) {
      salary = field;
      continue;
    }
    if (BARE_FIELD_RE.test(field)) continue;
    const isMode = MODE_PATTERNS.some(([, re]) => re.test(field));
    const isEmployment = EMPLOYMENT_PATTERNS.some(([, re]) => re.test(field)) && field.split(/\s+/).length <= 3;
    if (isEmployment && !isMode) continue;
    if (!isMode && ROLE_RE.test(field)) {
      roles.push(field);
      continue;
    }
    locationParts.push(field);
  }

  // A parenthetical next to the company often carries the location: "PrairieLearn (Remote US)".
  const companyParen = /\(([^)]*)\)/.exec(companyField)?.[1];
  if (companyParen && MODE_PATTERNS.some(([, re]) => re.test(companyParen))) locationParts.unshift(companyParen);

  if (!salary) {
    const bodySalary = /(?:[$€£]\s?\d[\d,.]*\s?[kK]?(?:\s*(?:-|–|to)\s*[$€£]?\s?\d[\d,.]*\s?[kK]?)?)/.exec(text);
    if (bodySalary && /[kK]|\d{2,3},\d{3}/.test(bodySalary[0])) salary = bodySalary[0].trim();
  }

  let workModes = detectAll(MODE_PATTERNS, headline);
  if (workModes.length === 0) workModes = detectAll(MODE_PATTERNS, uppercaseModeTokens(text));

  const visaSponsorship = VISA_NO_RE.test(text) ? false : VISA_YES_RE.test(text) ? true : null;

  return {
    id: raw.id,
    threadId,
    month,
    postedAt: raw.created_at,
    headline: redactEmails(headline),
    company: stripParentheticals(companyField) || companyField,
    roles,
    location: locationParts.length ? locationParts.join("; ") : null,
    workModes,
    employmentTypes: detectAll(EMPLOYMENT_PATTERNS, headline),
    salary,
    visaSponsorship,
    technologies: detectTechnologies(text),
    links,
    text: redactEmails(text),
    hnUrl: hnItemUrl(raw.id),
  };
}

/** Body text mentions "remote" casually all the time; only trust the shouted HN-convention tokens. */
function uppercaseModeTokens(text: string): string {
  return (text.match(/\b(?:REMOTE|HYBRID|ONSITE|ON-SITE)\b/g) ?? []).join(" ");
}
