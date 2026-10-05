# ado-mcp

MCP Azure DevOps minimal (builds en échec + logs + synthèse CI/CD) pour Dify.

1. Édite `.env` (ADO_ORG, ADO_PAT avec la permission Build > Read)
2. `docker compose up -d --build`
3. Dans Dify : Outils > MCP > ajouter :
   - Si Dify est sur une autre machine/VM : `http://<IP_DE_VOTRE_PC>:8000/sse` (ex: `http://172.20.92.104:8000/sse`)
   - Si Dify est sur la même machine : `http://host.docker.internal:8000/sse`


## Tester depuis le terminal

Pour tester le serveur MCP directement depuis votre terminal (sans Dify) :

```powershell
docker exec ado-mcp python test_client.py RDT-Simulator
```

Ou pour tester sur un autre projet Azure DevOps (ex. avec build en échec) :
```powershell
docker exec ado-mcp python test_client.py MEF.DirectiondeBudget.FE
```




