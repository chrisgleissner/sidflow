import { fetch } from "bun";

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  const token = process.env.GH_TOKEN;
  const tag = process.env.RELEASE_TAG;
  const body = process.env.RELEASE_BODY ?? "";
  const repository = process.env.GITHUB_REPOSITORY;

  if (!token) {
    die("GH_TOKEN not available; cannot update release notes.");
  }
  if (!repository) {
    die("GITHUB_REPOSITORY not set.");
  }
  if (!tag) {
    die("Release tag missing.");
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  } satisfies HeadersInit;

  const apiBase = `https://api.github.com/repos/${repository}/releases`;

  const tagUrl = `${apiBase}/tags/${encodeURIComponent(tag)}`;
  const existingResponse = await fetch(tagUrl, { headers });

  if (existingResponse.status === 404) {
    const createRes = await fetch(apiBase, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        tag_name: tag,
        name: tag,
        body,
        draft: false,
        prerelease: false
      })
    });

    if (!createRes.ok) {
      const details = await createRes.text();
      die(`Failed to create release: ${createRes.status} ${details}`);
    }

    console.log(`Created release ${tag} with updated notes.`);
    return;
  }

  if (!existingResponse.ok) {
    const details = await existingResponse.text();
    die(`Failed to load release: ${existingResponse.status} ${details}`);
  }

  const existing = await existingResponse.json();
  const releaseId = existing.id as number | undefined;
  if (!releaseId) {
    die("Release response missing id field.");
  }

  const patchRes = await fetch(`${apiBase}/${releaseId}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ body })
  });

  if (!patchRes.ok) {
    const details = await patchRes.text();
    die(`Failed to update release notes: ${patchRes.status} ${details}`);
  }

  console.log(`Updated release ${tag} notes successfully.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
