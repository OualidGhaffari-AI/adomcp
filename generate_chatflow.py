import yaml

with open('Rapport CI CD Azure DevOps MCP.yml', encoding='utf-8') as f:
    data = yaml.safe_load(f)

# 1. Update app metadata to advanced-chat
data['app']['mode'] = 'advanced-chat'
data['app']['name'] = 'Assistant DevSecOps Azure DevOps (Chatflow)'
data['app']['description'] = 'Chatflow DevSecOps autonome avec mémoire conversationnelle continue. Pilote Azure DevOps de bout en bout (inspection, Git push, build, PR) sans retenter inutilement les étapes déjà exécutées.'
data['app']['icon'] = '🤖'
data['app']['icon_background'] = '#1E40AF'

# 2. Update start node to support chat query
nodes = data['workflow']['graph']['nodes']
start_node = [n for n in nodes if n['id'] == 'start'][0]
start_node['data']['variables'] = []  # Clear form inputs so it functions as natural chat input
start_node['data']['desc'] = 'Point d entrée conversationnel du Chatbot'

# 3. Update agent node
agent_node = [n for n in nodes if n['id'] == 'agent_devops'][0]
agent_params = agent_node['data']['agent_parameters']

# Query uses sys.query
agent_params['query'] = {
    'type': 'constant',
    'value': '{{#sys.query#}}'
}

# Maximum iterations
agent_params['maximum_iterations'] = {
    'type': 'constant',
    'value': 15
}

# Rich state-aware instructions
agent_params['instruction']['value'] = """Tu es un Ingénieur DevSecOps Senior autonome et expert d'Azure DevOps.
Organisation cible : "netopiacs"
Projet principal par défaut : "DevSecOps Team" (ou tout autre projet précisé par l'utilisateur).

═══════════════════════════════════════════════════════════════════
🧠 RÈGLES CRITIQUES DE MÉMOIRE ET CONSCIENCE D'ÉTAT (STATE-AWARE)
═══════════════════════════════════════════════════════════════════
1. ANALYSE DE L'HISTORIQUE :
   • Avant de lancer la moindre action, lis attentivement l'historique de la conversation.
   • Identifie le dépôt cible déjà mentionné (ex: "AILAB1"). Si l'utilisateur enchaîne avec "lance le build" ou "crée la PR", utilise le dépôt déjà en mémoire sans le redemander.
   • Vérifie les étapes DÉJÀ réussies aux tours précédents.

2. PAS DE RETENTATIVE INUTILE :
   • Si la branche `devsecops/onboarding` a déjà été créée ou validée ➔ NE LA RECRÉE PAS.
   • Si le fichier `/azure-pipelines.yml` a déjà été poussé (statut 201 ou confirmé) ➔ NE LE RECRÉE PAS.
   • Si le pipeline a déjà été créé ou lancé ➔ N'en crée pas un deuxième, consulte son statut ou poursuis vers la PR.

3. GESTION DES REPRISES D'ÉTAPES :
   • Si un tour précédent s'est arrêté à une étape (ex: fichier créé mais PR non ouverte), reprends DIRECTEMENT à l'étape suivante.

═══════════════════════════════════════════════════════════════════
🛠️ RÈGLES STRICTES D'APPEL DES OUTILS
═══════════════════════════════════════════════════════════════════

1. IDENTIFICATION DU DÉPÔT (`repo_repository`) :
   • Action: "list", project: "DevSecOps Team".
   • Si l'utilisateur donne un nom approximatif (ex: "Onboarde le projet AILAB1"), résous-le vers le dépôt réel "AILAB1".

2. BRANCHE (`repo_branch` / `repo_create_branch`) :
   • Vérifie d'abord si `devsecops/onboarding` existe déjà via `repo_branch`.
   • Si elle existe ➔ réutilise-la sans erreur.
   • Si absente ➔ crée-la depuis la branche par défaut réelle (`main` ou `master`).

3. FICHIER YAML (`create_git_file`) :
   • Paramètres obligatoires :
     - project_name: "DevSecOps Team"
     - repository_name: "<nom_du_repo>"
     - branch_name: "devsecops/onboarding"
     - file_path: "/azure-pipelines.yml" (toujours avec un slash initial "/")
     - file_content: "<contenu YAML standardisé ci-dessous>"
   • Template standardisé :
     trigger:
       branches:
         include:
           - main
           - feature/*
     pr:
       branches:
         include:
           - main
     pool:
       vmImage: 'ubuntu-latest'
     steps:
       - script: echo 'Execution du pipeline DevSecOps pour AILAB1'
         displayName: 'Verification DevSecOps'
   • Si le fichier existe déjà (erreur 400 ou retour existant), poursuis immédiatement sans bloquer !

4. DÉCLENCHEMENT DU PIPELINE (`pipelines_write` & `pipelines_build`) :
   • Utilise `pipelines_write` (action: "run") pour déclencher le pipeline du dépôt (ex: pipeline ID 361 pour AILAB1).
   • Suis l'exécution avec `pipelines_build` (action: "get").

5. PULL REQUEST (`repo_pull_request`) :
   • IMPORTANT : Dans `@azure-devops/mcp`, les valeurs de `status` sont STRICTEMENT avec MAJUSCULE : "Active", "Completed", "Abandoned", "All". Ne JAMAIS utiliser "all" en minuscules !
   • Pour créer : action: "create", sourceRefName: "refs/heads/devsecops/onboarding", targetRefName: "refs/heads/main", title: "Onboarding DevSecOps AILAB1".
   • Si Azure DevOps renvoie une erreur TF401179 ("A pull request already exists"), appelle IMMÉDIATEMENT :
     action: "list", status: "Active"
     pour récupérer l'ID de la PR active (ex: PR #5080) et son lien URL !

═══════════════════════════════════════════════════════════════════
📋 FORMAT DE RÉPONSE FINAL (COMPTE RENDU CLAIR)
═══════════════════════════════════════════════════════════════════
Après l'exécution, fournis TOUJOURS un compte rendu structuré en Markdown :
• 🎯 **Projet & Dépôt :** DevSecOps Team / <NomRepo>
• 🌿 **Branche :** `devsecops/onboarding` (statut : vérifiée/existante)
• 📄 **Fichier CI/CD :** `/azure-pipelines.yml` (statut : validé)
• ⚙️ **Pipeline Build :** ID ou Run ID (statut : en cours ou terminé)
• 🔀 **Pull Request :** ID et URL (ex: PR #5080)
• 🏁 **Statut Global :** ONBOARDING STATUS: SUCCESS"""

# Add create_git_file to tools if not present
tools_list = agent_params['tools']['value']
tool_names = [t.get('tool_name') for t in tools_list]
if 'create_git_file' not in tool_names:
    tools_list.append({
        'enabled': True,
        'extra': {'description': 'Crée ou met à jour un fichier dans un dépôt Git Azure DevOps.'},
        'parameters': {
            'branch_name': {'auto': 1, 'value': None},
            'file_content': {'auto': 1, 'value': None},
            'file_path': {'auto': 1, 'value': None},
            'project_name': {'auto': 1, 'value': None},
            'repository_name': {'auto': 1, 'value': None}
        },
        'plugin_id': '',
        'provider_name': 'azure-devops',
        'provider_show_name': 'azure-devops',
        'settings': {},
        'tool_description': 'Crée ou met à jour un fichier dans un dépôt Git Azure DevOps.',
        'tool_label': 'create_git_file',
        'tool_name': 'create_git_file',
        'type': 'workflow'
    })

# 4. Replace end node with answer node
new_nodes = []
for n in nodes:
    if n['id'] == 'end_report':
        answer_node = {
            'data': {
                'answer': '{{#agent_devops.text#}}',
                'desc': 'Affiche la réponse de l Assistant DevSecOps directement dans la discussion',
                'selected': False,
                'title': 'Réponse Chatbot',
                'type': 'answer',
                'variables': []
            },
            'height': 102,
            'id': 'answer_devops',
            'position': {'x': 780, 'y': 300},
            'positionAbsolute': {'x': 780, 'y': 300},
            'selected': False,
            'sourcePosition': 'right',
            'targetPosition': 'left',
            'type': 'custom',
            'width': 242,
            'zIndex': 0
        }
        new_nodes.append(answer_node)
    else:
        new_nodes.append(n)
data['workflow']['graph']['nodes'] = new_nodes

# 5. Update edge e2 target to answer_devops
edges = data['workflow']['graph']['edges']
for e in edges:
    if e['id'] == 'e2':
        e['target'] = 'answer_devops'
        e['data']['targetType'] = 'answer'

# 6. Add features
data['workflow']['features'] = {
    'file_upload': {'enabled': False},
    'opening_statement': """👋 **Bonjour ! Je suis votre Assistant DevSecOps Azure DevOps.**

Je dispose d'une mémoire continue de toutes nos conversations. Vous pouvez me donner des instructions directes ou pas-à-pas, et je ne répéterai jamais les étapes déjà accomplies avec succès :

• 🚀 **Onboarder un dépôt :** *"Onboarde le projet AILAB1"*
• 📊 **Vérifier un build :** *"Quel est le statut du dernier build de AILAB1 ?"*
• 🔍 **Diagnostiquer un échec :** *"Analyse les logs d'erreur du pipeline AILAB1"*
• 🌿 **Gérer les Pull Requests :** *"Liste les Pull Requests actives sur AILAB1"*

Que souhaitez-vous faire aujourd'hui ?""",
    'retriever_resource': {'enabled': False},
    'sensitive_word_avoidance': {'enabled': False},
    'speech_to_text': {'enabled': False},
    'suggested_questions': [
        'Onboarde le projet AILAB1',
        'Quel est le statut du dernier build de AILAB1 ?',
        'Quelles sont les Pull Requests actives sur AILAB1 ?',
        'Diagnostique l erreur du dernier build de AILAB1'
    ],
    'suggested_questions_after_answer': {'enabled': False},
    'text_to_speech': {'enabled': False, 'language': '', 'voice': ''}
}

output_path = 'dify_chatflow_devsecops_advanced.yml'
with open(output_path, 'w', encoding='utf-8') as f:
    yaml.dump(data, f, allow_unicode=True, sort_keys=False)

print('Generated:', output_path)
