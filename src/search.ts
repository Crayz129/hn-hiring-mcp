import type { JobPost, WorkMode } from "./parse.ts";

export interface JobFilters {
  query?: string;
  location?: string;
  workMode?: WorkMode;
  technologies?: string[];
  hasSalary?: boolean;
  visaSponsorship?: boolean;
}

export type SortOrder = "relevance" | "newest";

const norm = (s: string) => s.toLowerCase();

/** Every whitespace-separated query term must appear; headline hits weigh more than body hits. */
function relevance(post: JobPost, terms: string[]): number {
  const headline = norm(post.headline);
  const body = norm(post.text);
  let score = 0;
  for (const term of terms) {
    if (headline.includes(term)) score += 3;
    else if (body.includes(term)) score += 1;
    else return 0;
  }
  return score;
}

export function filterJobs(posts: JobPost[], filters: JobFilters, sort: SortOrder): JobPost[] {
  const terms = filters.query ? norm(filters.query).split(/\s+/).filter(Boolean) : [];
  const location = filters.location ? norm(filters.location) : null;
  const scored: Array<{ post: JobPost; score: number }> = [];

  for (const post of posts) {
    if (filters.workMode && !post.workModes.includes(filters.workMode)) continue;
    if (filters.hasSalary && !post.salary) continue;
    if (filters.visaSponsorship !== undefined && post.visaSponsorship !== filters.visaSponsorship) continue;
    if (filters.technologies?.some((t) => !post.technologies.includes(t))) continue;
    // The location is almost always in the headline; the parsed field can miss unusual layouts.
    if (location && !norm(post.location ?? "").includes(location) && !norm(post.headline).includes(location)) continue;
    const score = terms.length ? relevance(post, terms) : 1;
    if (score > 0) scored.push({ post, score });
  }

  const byDate = (a: JobPost, b: JobPost) => b.postedAt.localeCompare(a.postedAt);
  scored.sort((a, b) => (sort === "relevance" && b.score !== a.score ? b.score - a.score : byDate(a.post, b.post)));
  return scored.map((s) => s.post);
}

export interface MonthTrend {
  month: string;
  totalPosts: number;
  technologies: Array<{ name: string; posts: number; sharePercent: number }>;
  workModes: Record<WorkMode, number>;
}

export function monthTrend(month: string, posts: JobPost[], technologies: string[]): MonthTrend {
  const pct = (n: number) => (posts.length ? Math.round((n / posts.length) * 1000) / 10 : 0);
  return {
    month,
    totalPosts: posts.length,
    technologies: technologies.map((name) => {
      const n = posts.filter((p) => p.technologies.includes(name)).length;
      return { name, posts: n, sharePercent: pct(n) };
    }),
    workModes: {
      remote: posts.filter((p) => p.workModes.includes("remote")).length,
      hybrid: posts.filter((p) => p.workModes.includes("hybrid")).length,
      onsite: posts.filter((p) => p.workModes.includes("onsite")).length,
    },
  };
}
