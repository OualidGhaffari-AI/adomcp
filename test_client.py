import asyncio
import json
import sys
from fastmcp import Client

PROJECT = sys.argv[1] if len(sys.argv) > 1 else "RDT-Simulator"
ENDPOINT = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:8000/sse"


async def main():
    print(f"Connexion au serveur MCP sur {ENDPOINT}...")
    async with Client(ENDPOINT) as client:
        tools = await client.list_tools()
        print(f"Outils détectés : {[t.name for t in tools]}")
        print(f"\n📊 Résumé CI/CD pour le projet : {PROJECT}...")
        summary_res = await client.call_tool("get_project_cicd_summary", {"project": PROJECT})
        print(json.dumps(summary_res.data, indent=2, ensure_ascii=False))

        print(f"\n🔍 Analyse du dernier build en échec pour le projet : {PROJECT}...")
        res = await client.call_tool("get_last_failed_build", {"project": PROJECT})
        data = res.data or res.structured_content
        print(json.dumps(data, indent=2, ensure_ascii=False))

        if isinstance(data, dict) and data.get("build_id"):
            build_id = data["build_id"]
            print(f"\n📋 Récupération des 20 dernières lignes de logs pour le build #{build_id}...")
            logs_res = await client.call_tool(
                "get_build_logs",
                {"project": PROJECT, "build_id": build_id, "tail": 20},
            )
            print("\nLogs :")
            print(logs_res.data or (logs_res.content[0].text if logs_res.content else ""))



if __name__ == "__main__":
    asyncio.run(main())
