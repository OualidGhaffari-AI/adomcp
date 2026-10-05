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


## Intégration dans Dify (DSL)

Deux fichiers DSL prêts à l'import sont inclus :

1. **`dify_cicd_mcp_workflow.yml` (Workflow automatique)** :
   - Prend en entrée le nom du projet (ex: `RDT-Simulator`, `MEF.DirectiondeBudget.FE`).
   - Interroge automatiquement les outils MCP (`get_project_cicd_summary`, `get_last_failed_build`, `get_build_logs`).
   - Affiche directement le rapport CI/CD complet formaté en Markdown dans Dify.

2. **`dify_cicd_agent_chat.yml` (Chatbot DevOps conversationnel)** :
   - Mode conversationnel pour auditer vos projets à la demande via une interface de chat.

### Comment l'importer dans Dify :
1. Dans Dify (sur votre VM) : cliquez sur **Studio** > **Créer depuis un fichier DSL** (ou *Import DSL*).
2. Sélectionnez `dify_cicd_mcp_workflow.yml`.
3. Dans le nœud **Agent CI/CD (MCP)**, vérifiez votre modèle LLM et la liaison avec les outils MCP `ado-mcp`.
4. Cliquez sur **Exécuter** !
