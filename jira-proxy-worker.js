/**
 * Texautomate → Jira proxy
 *
 * Deploy this as a Cloudflare Worker. It's the only thing that ever sees
 * your Jira email + API token — the browser page never has them.
 *
 * SETUP (Cloudflare dashboard, no CLI needed):
 * 1. cloudflare.com → sign up / log in (free tier is plenty)
 * 2. Workers & Pages → Create → "Create Worker" → give it a name (e.g. texauto-jira-proxy)
 * 3. It opens the online editor — delete the placeholder code, paste this whole file in, Save.
 * 4. Go to Settings → Variables → "Add variable" three times, marking each as
 *    "Encrypt" (this is what keeps them out of logs/dashboard view):
 *      JIRA_SITE   = yourcompany.atlassian.net
 *      JIRA_EMAIL  = you@company.com
 *      JIRA_TOKEN  = the API token from id.atlassian.com → Security → API tokens
 * 5. Settings → Variables → also add ALLOWED_ORIGIN = https://clintobrown.github.io
 *    (locks the proxy so only your page can call it — not required as "Encrypt")
 * 6. Deploy. Copy the worker's URL (looks like
 *    https://texauto-jira-proxy.<your-subdomain>.workers.dev) into the
 *    "PROXY URL" field in Texautomate's Jira Connection panel.
 *
 * That's it — no server to maintain, free for this volume of traffic.
 */

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || "*";
    const corsHeaders = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Browsers send an OPTIONS preflight before the real POST — answer it.
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "POST only" }), {
        status: 405,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: "invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const { project, issueType, summary, description, labels } = body;
    if (!project || !summary) {
      return new Response(
        JSON.stringify({ error: "project and summary are required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (!env.JIRA_SITE || !env.JIRA_EMAIL || !env.JIRA_TOKEN) {
      return new Response(
        JSON.stringify({ error: "proxy is missing JIRA_SITE / JIRA_EMAIL / JIRA_TOKEN env vars" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const auth = "Basic " + btoa(`${env.JIRA_EMAIL}:${env.JIRA_TOKEN}`);

    try {
      const jiraRes = await fetch(`https://${env.JIRA_SITE}/rest/api/3/issue`, {
        method: "POST",
        headers: {
          Authorization: auth,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          fields: {
            project: { key: project },
            issuetype: { name: issueType || "Task" },
            summary,
            labels: labels || [],
            description: {
              type: "doc",
              version: 1,
              content: [{ type: "paragraph", content: [{ type: "text", text: description || "" }] }],
            },
          },
        }),
      });

      const text = await jiraRes.text();

      return new Response(text, {
        status: jiraRes.status,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: "upstream request failed: " + err.message }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
  },
};
