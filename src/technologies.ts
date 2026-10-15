/**
 * Canonical technology names and the patterns that detect them in a job post.
 * Patterns are deliberately conservative: a missed mention is better than a false one,
 * because hiring_trends reports shares and false positives skew them.
 */
const TECHNOLOGY_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  // Languages
  ["Python", /\bpython\b/i],
  ["TypeScript", /\btypescript\b/i],
  ["JavaScript", /\bjavascript\b/i],
  // "Go" is an ordinary English word, so only count it next to list punctuation or as "Golang".
  ["Go", /\b[Gg]olang\b|(?<=^|[\s(,/|])Go(?=[,/)|;]|\s+(?:and|or|\/|&)\s|\s*$)/m],
  ["Rust", /\bRust\b/],
  ["Java", /\bjava\b(?!\s*script)/i],
  ["Kotlin", /\bkotlin\b/i],
  ["Scala", /\bscala\b/i],
  ["C++", /\bc\+\+(?!\w)/i],
  ["C#", /\bc#(?!\w)/i],
  [".NET", /(?<![\w.])\.net\b/i],
  ["Ruby", /\bruby\b/i],
  ["PHP", /\bphp\b/i],
  ["Elixir", /\belixir\b/i],
  ["Erlang", /\berlang\b/i],
  ["Clojure", /\bclojure\b/i],
  ["Haskell", /\bhaskell\b/i],
  ["OCaml", /\bocaml\b/i],
  ["Swift", /\bSwift\b/],
  ["Zig", /\bZig\b/],
  ["Solidity", /\bsolidity\b/i],
  ["SQL", /\bsql\b/i],
  // Frameworks and runtimes
  ["Node.js", /\bnode(?:\.?js)?\b(?![-\w])/i],
  ["React", /\breact\b(?!\s+native)/i],
  ["React Native", /\breact\s+native\b/i],
  ["Next.js", /\bnext\.?js\b/i],
  ["Vue", /\bvue(?:\.?js)?\b/i],
  ["Angular", /\bangular\b/i],
  ["Svelte", /\bsvelte(?:kit)?\b/i],
  ["Django", /\bdjango\b/i],
  ["FastAPI", /\bfastapi\b/i],
  ["Flask", /\bflask\b/i],
  ["Rails", /\b(?:ruby on )?rails\b/i],
  ["Laravel", /\blaravel\b/i],
  ["Spring", /\bspring(?:\s*boot)?\b/i],
  ["Flutter", /\bflutter\b/i],
  ["iOS", /\bios\b/i],
  ["Android", /\bandroid\b/i],
  ["GraphQL", /\bgraphql\b/i],
  ["gRPC", /\bgrpc\b/i],
  // Data and infrastructure
  ["PostgreSQL", /\bpostgres(?:ql)?\b/i],
  ["MySQL", /\bmysql\b/i],
  ["MongoDB", /\bmongo(?:db)?\b/i],
  ["Redis", /\bredis\b/i],
  ["Kafka", /\bkafka\b/i],
  ["Elasticsearch", /\belastic(?:search)?\b/i],
  ["ClickHouse", /\bclickhouse\b/i],
  ["Snowflake", /\bsnowflake\b/i],
  ["Spark", /\b(?:apache\s+)?spark\b/i],
  ["Airflow", /\bairflow\b/i],
  ["dbt", /\bdbt\b/i],
  ["AWS", /\baws\b|\bamazon web services\b/i],
  ["GCP", /\bgcp\b|\bgoogle cloud\b/i],
  ["Azure", /\bazure\b/i],
  ["Kubernetes", /\bkubernetes\b|\bk8s\b/i],
  ["Docker", /\bdocker\b/i],
  ["Terraform", /\bterraform\b/i],
  ["Linux", /\blinux\b/i],
  // ML / AI
  ["PyTorch", /\bpytorch\b/i],
  ["TensorFlow", /\btensorflow\b/i],
  ["JAX", /\bJAX\b/],
  ["CUDA", /\bcuda\b/i],
  ["LLM", /\bllms?\b/i],
  ["RAG", /\bRAG\b/],
  ["MCP", /\bMCP\b|\bmodel context protocol\b/i],
  ["LangChain", /\blangchain\b/i],
];

export const KNOWN_TECHNOLOGIES: readonly string[] = TECHNOLOGY_PATTERNS.map(([name]) => name);

const BY_LOWERCASE = new Map(TECHNOLOGY_PATTERNS.map(([name, re]) => [name.toLowerCase(), { name, re }]));
const ALIASES: Record<string, string> = {
  golang: "go",
  ts: "typescript",
  js: "javascript",
  node: "node.js",
  nodejs: "node.js",
  postgres: "postgresql",
  k8s: "kubernetes",
  nextjs: "next.js",
  dotnet: ".net",
  "c sharp": "c#",
  cpp: "c++",
  "google cloud": "gcp",
};

/** Maps user input such as "golang" or "postgres" to the canonical name, or undefined if unknown. */
export function canonicalTechnology(input: string): string | undefined {
  const key = input.trim().toLowerCase();
  return BY_LOWERCASE.get(ALIASES[key] ?? key)?.name;
}

export function detectTechnologies(text: string): string[] {
  return TECHNOLOGY_PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name);
}
