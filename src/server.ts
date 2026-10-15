import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import { HnHiringError } from "./errors.ts";
import type { HnClient } from "./hn-client.ts";
import { hnItemUrl, type JobPost } from "./parse.ts";
import { filterJobs, monthTrend } from "./search.ts";
import { canonicalTechnology, KNOWN_TECHNOLOGIES } from "./technologies.ts";

export const SERVER_NAME = "hn-hiring-mcp";
export const SERVER_VERSION = "0.1.0";

const MONTH = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM, e.g. 2026-10")
  .describe("Thread month as YYYY-MM. Defaults to the latest thread.");
const WORK_MODE = z.enum(["remote", "hybrid", "onsite"]);
const EMPLOYMENT_TYPE = z.enum(["full-time", "part-time", "contract", "internship"]);

const jobSummaryShape = {
  id: z.number().int().describe("HN comment id; pass to get_job for the full post"),
  company: z.string(),
  roles: z.array(z.string()),
  location: z.string().nullable(),
  work_modes: z.array(WORK_MODE),
  employment_types: z.array(EMPLOYMENT_TYPE),
  salary: z.string().nullable().describe("As written by the poster"),
  visa_sponsorship: z.boolean().nullable().describe("null when the post does not mention it"),
  technologies: z.array(z.string()),
  posted_at: z.string(),
  headline: z.string(),
  excerpt: z.string(),
  hn_url: z.string().describe("Link to the original post; apply via the instructions there"),
};
const JobSummary = z.object(jobSummaryShape);
const JobDetails = z.object({
  ...jobSummaryShape,
  month: z.string(),
  thread_id: z.number().int(),
  text: z.string().describe("Full post text; e-mail addresses are replaced with [email on HN]"),
  links: z.array(z.string()),
});

function summary(post: JobPost): z.infer<typeof JobSummary> {
  const body = post.text.slice(post.text.indexOf("\n\n") + 2 || 0).replace(/\s+/g, " ").trim();
  return {
    id: post.id,
    company: post.company,
    roles: post.roles,
    location: post.location,
    work_modes: post.workModes,
    employment_types: post.employmentTypes,
    salary: post.salary,
    visa_sponsorship: post.visaSponsorship,
    technologies: post.technologies,
    posted_at: post.postedAt,
    headline: post.headline,
    excerpt: body.length > 240 ? `${body.slice(0, 240)}…` : body,
    hn_url: post.hnUrl,
  };
}

function canonicalTechnologies(input: string[] | undefined): string[] | undefined {
  if (!input?.length) return undefined;
  return input.map((t) => {
    const name = canonicalTechnology(t);
    if (!name) {
      throw new HnHiringError("INVALID_INPUT", `Unknown technology "${t}". Known technologies: ${KNOWN_TECHNOLOGIES.join(", ")}. For anything else use the free-text "query".`);
    }
    return name;
  });
}

/** Tool results carry both typed structuredContent and a JSON text copy for clients without structured output. */
async function respond<T extends Record<string, unknown>>(run: () => Promise<T>): Promise<CallToolResult> {
  try {
    const data = await run();
    return { structuredContent: data, content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  } catch (err) {
    const message = err instanceof HnHiringError ? `${err.code}: ${err.message}` : `INTERNAL_ERROR: ${(err as Error).message}`;
    return { isError: true, content: [{ type: "text", text: message }] };
  }
}

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: true } as const;

export function createServer(hn: HnClient): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        'Read-only access to the monthly Hacker News "Ask HN: Who is hiring?" threads. ' +
        "Use search_jobs to find posts, get_job for the full text, hiring_trends to compare technologies across months. " +
        "Always give the user the hn_url so they can read the original post and apply there.",
    },
  );

  server.registerTool(
    "list_hiring_threads",
    {
      title: "List hiring threads",
      description: 'Lists the most recent monthly "Ask HN: Who is hiring?" threads, newest first.',
      inputSchema: { limit: z.number().int().min(1).max(24).default(6) },
      outputSchema: {
        threads: z.array(
          z.object({ id: z.number().int(), month: z.string(), title: z.string(), posted_at: z.string(), comment_count: z.number().int(), hn_url: z.string() }),
        ),
      },
      annotations: READ_ONLY,
    },
    ({ limit }) =>
      respond(async () => ({
        threads: (await hn.listThreads(limit)).map((t) => ({
          id: t.id,
          month: t.month,
          title: t.title,
          posted_at: t.postedAt,
          comment_count: t.commentCount,
          hn_url: hnItemUrl(t.id),
        })),
      })),
  );

  server.registerTool(
    "search_jobs",
    {
      title: "Search job posts",
      description:
        'Searches one month of "Who is hiring?" posts. All filters are optional and combined with AND. ' +
        "Returns compact summaries; call get_job for the full text of a post.",
      inputSchema: {
        query: z.string().max(200).optional().describe("Free-text terms, all must appear, e.g. 'machine learning Berlin'"),
        month: MONTH.optional(),
        location: z.string().max(100).optional().describe("Substring of the location, e.g. 'Europe', 'London', 'US'"),
        work_mode: WORK_MODE.optional(),
        technologies: z.array(z.string()).max(10).optional().describe("All must be mentioned, e.g. ['Python', 'PostgreSQL']"),
        has_salary: z.boolean().optional().describe("Only posts that state compensation"),
        visa_sponsorship: z.boolean().optional().describe("true: offers sponsorship/relocation; false: explicitly does not"),
        sort: z.enum(["relevance", "newest"]).optional().describe("Default: relevance when query is set, otherwise newest"),
        limit: z.number().int().min(1).max(50).default(20),
        offset: z.number().int().min(0).default(0),
      },
      outputSchema: {
        month: z.string(),
        thread_id: z.number().int(),
        total_matches: z.number().int(),
        offset: z.number().int(),
        next_offset: z.number().int().nullable(),
        jobs: z.array(JobSummary),
      },
      annotations: READ_ONLY,
    },
    (args) =>
      respond(async () => {
        const technologies = canonicalTechnologies(args.technologies);
        const ref = args.month ? await hn.findThread(args.month) : (await hn.listThreads(1))[0];
        if (!ref) throw new HnHiringError("NOT_FOUND", 'No "Who is hiring?" threads found.');
        const thread = await hn.getThread(ref.id);
        const matches = filterJobs(
          thread.posts,
          {
            query: args.query,
            location: args.location,
            workMode: args.work_mode,
            technologies,
            hasSalary: args.has_salary,
            visaSponsorship: args.visa_sponsorship,
          },
          args.sort ?? (args.query ? "relevance" : "newest"),
        );
        const page = matches.slice(args.offset, args.offset + args.limit);
        const next = args.offset + page.length;
        return {
          month: thread.month,
          thread_id: thread.id,
          total_matches: matches.length,
          offset: args.offset,
          next_offset: next < matches.length ? next : null,
          jobs: page.map(summary),
        };
      }),
  );

  server.registerTool(
    "get_job",
    {
      title: "Get job post",
      description: "Returns the full text and parsed fields of one job post by its HN id (from search_jobs).",
      inputSchema: { id: z.number().int().positive().describe("HN comment id of the job post") },
      outputSchema: JobDetails.shape,
      annotations: READ_ONLY,
    },
    ({ id }) =>
      respond(async () => {
        const post = await hn.getPost(id);
        return { ...summary(post), month: post.month, thread_id: post.threadId, text: post.text, links: post.links };
      }),
  );

  server.registerTool(
    "hiring_trends",
    {
      title: "Hiring trends",
      description:
        "For each of the last N monthly threads, counts how many posts mention each technology and how many offer remote/hybrid/onsite. " +
        "Good for questions like 'is demand for Rust growing?'. The first call for many months can take ~1 s per uncached month.",
      inputSchema: {
        technologies: z.array(z.string()).min(1).max(10).describe("e.g. ['Python', 'TypeScript', 'Rust']"),
        months: z.number().int().min(1).max(12).default(6),
      },
      outputSchema: {
        months: z.array(
          z.object({
            month: z.string(),
            total_posts: z.number().int(),
            technologies: z.array(z.object({ name: z.string(), posts: z.number().int(), share_percent: z.number() })),
            work_modes: z.object({ remote: z.number().int(), hybrid: z.number().int(), onsite: z.number().int() }),
          }),
        ),
      },
      annotations: READ_ONLY,
    },
    ({ technologies, months }) =>
      respond(async () => {
        const names = canonicalTechnologies(technologies)!;
        const refs = await hn.listThreads(months);
        const result = [];
        for (const ref of refs.toReversed()) {
          const thread = await hn.getThread(ref.id);
          const trend = monthTrend(thread.month, thread.posts, names);
          result.push({
            month: trend.month,
            total_posts: trend.totalPosts,
            technologies: trend.technologies.map((t) => ({ name: t.name, posts: t.posts, share_percent: t.sharePercent })),
            work_modes: trend.workModes,
          });
        }
        return { months: result };
      }),
  );

  return server;
}
