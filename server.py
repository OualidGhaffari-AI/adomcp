import os
import httpx
from fastmcp import FastMCP

mcp = FastMCP("devops-cicd")
ORG, PAT = os.environ["ADO_ORG"], os.environ["ADO_PAT"]
BASE = f"https://dev.azure.com/{ORG}"


def ado(path: str):
    r = httpx.get(f"{BASE}/{path}", auth=("", PAT), timeout=30)
    r.raise_for_status()
    return r.json()


@mcp.tool()
def get_last_failed_build(project: str) -> dict:
    """Dernier build en échec d'un projet (id, branche, commit, auteur)."""
    builds = ado(
        f"{project}/_apis/build/builds?resultFilter=failed&$top=1&api-version=7.1"
    )["value"]
    if not builds:
        return {"status": "PIPELINE_OK"}
    b = builds[0]
    return {
        "build_id": b["id"],
        "branch": b["sourceBranch"],
        "commit": b["sourceVersion"],
        "author_name": b["requestedFor"]["displayName"],
        "author_email": b["requestedFor"].get("uniqueName"),
        "url": b["_links"]["web"]["href"],
    }


@mcp.tool()
def get_build_logs(project: str, build_id: int, tail: int = 100) -> str:
    """Dernières lignes des logs d'un build."""
    logs = ado(f"{project}/_apis/build/builds/{build_id}/logs?api-version=7.1")["value"]
    last = logs[-1]["id"]
    txt = httpx.get(
        f"{BASE}/{project}/_apis/build/builds/{build_id}/logs/{last}?api-version=7.1",
        auth=("", PAT),
        timeout=30,
    ).text
    return "\n".join(txt.splitlines()[-tail:])


@mcp.tool()
def get_project_cicd_summary(project: str) -> dict:
    """Rapport CI/CD résumé d'un projet (santé, total de builds, statut du dernier build)."""
    builds = ado(f"{project}/_apis/build/builds?$top=10&api-version=7.1")["value"]
    pipelines = ado(f"{project}/_apis/pipelines?api-version=7.1-preview.1")["value"]
    if not builds:
        return {
            "project": project,
            "pipelines_count": len(pipelines),
            "total_recent_builds": 0,
            "status": "NO_RUNS_YET",
            "message": "Le pipeline existe mais aucun build n'a encore été exécuté.",
        }
    latest = builds[0]
    failed = [b for b in builds if b.get("result") == "failed"]
    return {
        "project": project,
        "pipelines_count": len(pipelines),
        "total_recent_builds": len(builds),
        "latest_build": {
            "id": latest["id"],
            "status": latest.get("status"),
            "result": latest.get("result"),
            "branch": latest.get("sourceBranch"),
            "author": latest.get("requestedFor", {}).get("displayName"),
            "finish_time": latest.get("finishTime") or latest.get("startTime"),
        },
        "recent_failed_count": len(failed),
        "status": "FAILED" if latest.get("result") == "failed" else ("STABLE" if latest.get("result") == "succeeded" else latest.get("result", "UNKNOWN")),
    }



if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    mcp.run(transport="sse", host="0.0.0.0", port=port)

