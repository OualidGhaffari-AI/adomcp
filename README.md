# Azure DevOps MCP Server

Serveur MCP officiel Azure DevOps (`@azure-devops/mcp`) déployé derrière un bridge HTTP (`supergateway`) au format StreamableHTTP pour **Dify**.

## Prérequis et Configuration

1. Créez un fichier `.env` à la racine :
```env
ADO_ORG=netopiacs
ADO_PAT=votre_pat_azure_devops
# Base64 de "<votre_email>:<votre_pat>"
ADO_PAT_B64=base64_ici
```

> **Astuce PowerShell pour générer `ADO_PAT_B64` :**
> ```powershell
> [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("o.ghaffari@netopia.ma:VOTRE_PAT"))
> ```

## Démarrage

```bash
docker compose up -d
```

Pour voir les logs :
```bash
docker compose logs -f ado-mcp
```

## Intégration dans Dify

1. Dans Dify, allez dans **Outils** (Tools) > **MCP** > **Ajouter un serveur MCP (HTTP)**.
2. Renseignez les paramètres suivants :
   - **Nom / Identifiant** : `azure-devops`
   - **URL du serveur** : `http://ado-mcp:8000/mcp`
   - **Authentification** :
     - Désactiver DCR (Dynamic Client Registration)
     - Laisser OAuth vide
3. Cliquez sur **Enregistrer & Autoriser**.
4. Dify découvrira l'ensemble des outils natifs Azure DevOps :
   - Core (projets, équipes, processus)
   - Repositories (dépôts Git, branches, commits, PRs)
   - Pipelines (définitions, builds, runs)
   - Work items (bugs, user stories, requêtes WIQL)
   - Wiki
