/**
 * ADO-MCP Dynamic Multi-Tenant Gateway
 * 
 * Passerelle d'authentification et de routage par utilisateur pour @azure-devops/mcp.
 * - Permet à chaque utilisateur de renseigner son Personal Access Token (PAT) au 1er usage.
 * - Chiffre les tokens au repos avec AES-256-GCM.
 * - Isole les processus mcp-server-azuredevops par utilisateur (droits réels et traçabilité).
 * - Expose 3 outils de gouvernance : auth_check_status, auth_register_token, auth_revoke_token.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PORT = parseInt(process.env.PORT || '8000', 10);
const ORG_NAME = process.env.AZURE_DEVOPS_ORG || 'netopiacs';
const DATA_DIR = process.env.DATA_DIR || '/data';
const TOKENS_FILE = path.join(DATA_DIR, 'user_tokens.json');
const MASTER_KEY_FILE = path.join(DATA_DIR, '.master.key');

// Assurer l'existence du dossier de données
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ============================================================================
// 1. SÉCURITÉ & CHIFFREMENT (AES-256-GCM)
// ============================================================================

function getMasterKey() {
  if (process.env.GATEWAY_ENCRYPTION_KEY) {
    return crypto.createHash('sha256').update(process.env.GATEWAY_ENCRYPTION_KEY).digest();
  }
  if (!fs.existsSync(MASTER_KEY_FILE)) {
    const key = crypto.randomBytes(32);
    fs.writeFileSync(MASTER_KEY_FILE, key);
    return key;
  }
  return fs.readFileSync(MASTER_KEY_FILE);
}

const MASTER_KEY = getMasterKey();

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', MASTER_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(cipherText) {
  try {
    const [ivHex, authTagHex, encrypted] = cipherText.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', MASTER_KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('[Crypto] Erreur de déchiffrement:', err.message);
    return null;
  }
}

function loadTokensDB() {
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('[DB] Erreur de lecture de la base des tokens:', err.message);
  }
  return {};
}

function saveTokensDB(db) {
  try {
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error('[DB] Erreur de sauvegarde de la base des tokens:', err.message);
  }
}

// ============================================================================
// 2. VALIDATION AZURE DEVOPS API
// ============================================================================

async function validateAzureDevOpsPAT(pat) {
  const url = `https://dev.azure.com/${ORG_NAME}/_apis/projects?api-version=7.0&$top=1`;
  const authHeader = 'Basic ' + Buffer.from(':' + pat.trim()).toString('base64');
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': authHeader,
        'Accept': 'application/json'
      }
    });
    if (res.status === 200) {
      // Récupération de l'identité connectée si possible via profile API
      return { valid: true, error: null };
    }
    return { valid: false, error: `Azure DevOps a renvoyé le statut HTTP ${res.status} (accès refusé ou PAT invalide)` };
  } catch (err) {
    return { valid: false, error: `Erreur de connexion réseau vers dev.azure.com : ${err.message}` };
  }
}

// ============================================================================
// 3. GESTION DES WORKERS MCP (Un sous-processus par utilisateur)
// ============================================================================

class MCPWorker {
  constructor(userId, pat) {
    this.userId = userId;
    this.pat = pat;
    this.process = null;
    this.pendingRequests = new Map();
    this.requestId = 1;
    this.buffer = '';
    this.lastUsed = Date.now();
    this.isReady = false;
    this.initPromise = this.start();
  }

  start() {
    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        PERSONAL_ACCESS_TOKEN: this.pat,
        AZURE_DEVOPS_ORG: ORG_NAME,
      };

      const args = [
        ORG_NAME,
        '--authentication', 'pat',
        '-d', 'core', 'work', 'work-items', 'repositories', 'pipelines', 'wiki'
      ];

      this.process = spawn('mcp-server-azuredevops', args, {
        env,
        stdio: ['pipe', 'pipe', 'inherit'],
      });

      this.process.stdout.on('data', (chunk) => {
        this.buffer += chunk.toString('utf8');
        let newlineIdx;
        while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
          const line = this.buffer.slice(0, newlineIdx).trim();
          this.buffer = this.buffer.slice(newlineIdx + 1);
          if (line) {
            this.handleMessage(line);
          }
        }
      });

      this.process.on('error', (err) => {
        console.error(`[Worker ${this.userId}] Erreur de démarrage:`, err);
        reject(err);
      });

      this.process.on('exit', (code) => {
        console.log(`[Worker ${this.userId}] Processus arrêté avec code ${code}`);
        this.isReady = false;
      });

      // Initialisation du protocole MCP
      const initReq = {
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'ado-mcp-gateway', version: '1.0.0' },
        },
      };

      this.sendRaw(initReq).then((initRes) => {
        // Envoi de la notification initialized
        this.process.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
        this.isReady = true;
        resolve(initRes);
      }).catch(reject);
    });
  }

  handleMessage(line) {
    try {
      const msg = JSON.parse(line);
      if (msg.id && this.pendingRequests.has(msg.id)) {
        const { resolve } = this.pendingRequests.get(msg.id);
        this.pendingRequests.delete(msg.id);
        resolve(msg);
      }
    } catch (err) {
      console.error(`[Worker ${this.userId}] Erreur JSON message:`, err.message, line);
    }
  }

  sendRaw(req) {
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(req.id, { resolve, reject });
      this.process.stdin.write(JSON.stringify(req) + '\n');
    });
  }

  async call(method, params = {}) {
    await this.initPromise;
    this.lastUsed = Date.now();
    const reqId = ++this.requestId;
    const req = { jsonrpc: '2.0', id: reqId, method, params };
    return this.sendRaw(req);
  }

  destroy() {
    if (this.process && !this.process.killed) {
      this.process.kill();
    }
  }
}

// Pool de workers en mémoire : userId => MCPWorker
const workerPool = new Map();

// Nettoyage automatique des workers inactifs (> 30 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [userId, worker] of workerPool.entries()) {
    if (now - worker.lastUsed > 30 * 60 * 1000) {
      console.log(`[WorkerPool] Arrêt worker inactif: ${userId}`);
      worker.destroy();
      workerPool.delete(userId);
    }
  }
}, 5 * 60 * 1000);

async function getWorkerForUser(userId) {
  const normalizedUser = (userId || 'default').toLowerCase().trim();
  
  if (workerPool.has(normalizedUser)) {
    return workerPool.get(normalizedUser);
  }

  // Chercher le token en base
  const db = loadTokensDB();
  let pat = null;
  if (db[normalizedUser] && db[normalizedUser].encryptedPat) {
    pat = decrypt(db[normalizedUser].encryptedPat);
  }

  // Fallback au compte de service par défaut si configuré
  if (!pat) {
    pat = process.env.PERSONAL_ACCESS_TOKEN || process.env.AZURE_DEVOPS_PAT || null;
  }

  if (!pat) {
    return null;
  }

  const worker = new MCPWorker(normalizedUser, pat);
  workerPool.set(normalizedUser, worker);
  return worker;
}

// ============================================================================
// 4. OUTILS D'AUTHENTIFICATION DE LA PASSERELLE (GOUVERNANCE)
// ============================================================================

const AUTH_TOOLS = [
  {
    name: 'auth_check_status',
    description: "Vérifie si l'utilisateur est authentifié sur Azure DevOps avec un Personal Access Token (PAT) valide.",
    inputSchema: {
      type: 'object',
      properties: {
        user_id: {
          type: 'string',
          description: "Identifiant ou email de l'utilisateur à vérifier (ex: 'oualid.ghaffari')."
        }
      },
      required: ['user_id']
    }
  },
  {
    name: 'auth_register_token',
    description: "Enregistre et chiffre le Personal Access Token (PAT) Azure DevOps de l'utilisateur pour lui permettre d'exécuter des actions sécurisées.",
    inputSchema: {
      type: 'object',
      properties: {
        user_id: {
          type: 'string',
          description: "Identifiant ou email de l'utilisateur (ex: 'oualid.ghaffari')."
        },
        pat: {
          type: 'string',
          description: "Personal Access Token Azure DevOps avec droits Code & Build."
        }
      },
      required: ['user_id', 'pat']
    }
  },
  {
    name: 'auth_revoke_token',
    description: "Supprime le Personal Access Token (PAT) enregistré d'un utilisateur et déconnecte sa session.",
    inputSchema: {
      type: 'object',
      properties: {
        user_id: {
          type: 'string',
          description: "Identifiant ou email de l'utilisateur à déconnecter."
        }
      },
      required: ['user_id']
    }
  }
];

async function handleAuthToolCall(name, args) {
  const userId = (args.user_id || '').toLowerCase().trim();
  if (!userId) {
    return {
      content: [{ type: 'text', text: "Erreur : 'user_id' est requis pour les opérations d'authentification." }],
      isError: true
    };
  }

  const db = loadTokensDB();

  if (name === 'auth_check_status') {
    if (!db[userId] || !db[userId].encryptedPat) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            authenticated: false,
            user_id: userId,
            message: `L'utilisateur '${userId}' n'a pas encore de Personal Access Token (PAT) enregistré. Demandez-lui son token pour continuer.`
          }, null, 2)
        }]
      };
    }

    const pat = decrypt(db[userId].encryptedPat);
    const check = await validateAzureDevOpsPAT(pat);
    if (!check.valid) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            authenticated: false,
            user_id: userId,
            message: `Le token enregistré pour '${userId}' a expiré ou a été révoqué. Demandez un nouveau token.`
          }, null, 2)
        }]
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          authenticated: true,
          user_id: userId,
          organization: ORG_NAME,
          registered_at: db[userId].registered_at,
          message: `L'utilisateur '${userId}' est authentifié avec succès sur Azure DevOps (${ORG_NAME}).`
        }, null, 2)
      }]
    };
  }

  if (name === 'auth_register_token') {
    const pat = (args.pat || '').trim();
    if (!pat) {
      return {
        content: [{ type: 'text', text: "Erreur : Le Personal Access Token (PAT) ne peut pas être vide." }],
        isError: true
      };
    }

    // Validation préalable en direct auprès d'Azure DevOps
    const check = await validateAzureDevOpsPAT(pat);
    if (!check.valid) {
      return {
        content: [{
          type: 'text',
          text: `❌ Échec de validation du token : ${check.error}. Veuillez vérifier les scopes (Code, Build) et réessayer.`
        }],
        isError: true
      };
    }

    // Enregistrement chiffré
    db[userId] = {
      encryptedPat: encrypt(pat),
      registered_at: new Date().toISOString(),
    };
    saveTokensDB(db);

    // Supprimer l'ancien worker s'il existait pour recharger avec le nouveau token
    if (workerPool.has(userId)) {
      workerPool.get(userId).destroy();
      workerPool.delete(userId);
    }

    return {
      content: [{
        type: 'text',
        text: `✅ Personal Access Token validé et enregistré avec succès pour '${userId}'. Les opérations Azure DevOps seront désormais exécutées en votre nom.`
      }]
    };
  }

  if (name === 'auth_revoke_token') {
    if (db[userId]) {
      delete db[userId];
      saveTokensDB(db);
    }
    if (workerPool.has(userId)) {
      workerPool.get(userId).destroy();
      workerPool.delete(userId);
    }
    return {
      content: [{
        type: 'text',
        text: `✅ Accès Azure DevOps révoqué avec succès pour '${userId}'. Vos identifiants ont été effacés.`
      }]
    };
  }

  return {
    content: [{ type: 'text', text: `Outil inconnu : ${name}` }],
    isError: true
  };
}

// ============================================================================
// 5. CACHE DE LA LISTE DES OUTILS AZURE DEVOPS
// ============================================================================

let cachedToolsList = null;

async function getCombinedToolsList() {
  if (cachedToolsList) {
    return cachedToolsList;
  }

  // Tenter de récupérer la liste des outils depuis un worker temporaire
  let adoTools = [];
  try {
    const dummyWorker = await getWorkerForUser('__discovery__');
    if (dummyWorker) {
      const res = await dummyWorker.call('tools/list');
      if (res && res.result && Array.isArray(res.result.tools)) {
        adoTools = res.result.tools;
      }
    }
  } catch (err) {
    console.warn('[Discovery] Impossible de lister les outils du binaire officiel au démarrage:', err.message);
  }

  // Ajouter l'argument user_id optionnel à chaque outil Azure DevOps
  const enhancedAdoTools = adoTools.map(t => {
    const toolCopy = JSON.parse(JSON.stringify(t));
    if (!toolCopy.inputSchema) toolCopy.inputSchema = { type: 'object', properties: {} };
    if (!toolCopy.inputSchema.properties) toolCopy.inputSchema.properties = {};
    toolCopy.inputSchema.properties.user_id = {
      type: 'string',
      description: "Identifiant ou email de l'utilisateur actif pour exécuter cette action avec son PAT personnel."
    };
    return toolCopy;
  });

  cachedToolsList = [...AUTH_TOOLS, ...enhancedAdoTools];
  return cachedToolsList;
}

// ============================================================================
// 6. SERVEUR HTTP MCP (Streamable HTTP & SSE)
// ============================================================================

const server = http.createServer(async (req, res) => {
  // En-têtes CORS universels
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Dify-User-ID, X-User-Id');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Route SSE (GET /sse ou GET /mcp)
  if (req.method === 'GET' && (url.pathname === '/sse' || url.pathname === '/mcp')) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    const sessionId = crypto.randomUUID();
    res.write(`event: endpoint\ndata: /mcp?sessionId=${sessionId}\n\n`);
    return;
  }

  // Route JSON-RPC (POST /mcp ou POST /messages)
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const rpcReq = JSON.parse(body);
        const { id, method, params } = rpcReq;

        // Extraction de l'utilisateur à partir des headers HTTP
        const headerUserId = req.headers['x-dify-user-id'] || req.headers['x-user-id'] || null;

        // Gestion du protocole d'initialisation MCP
        if (method === 'initialize') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: {
                name: 'ado-mcp-multi-tenant-gateway',
                version: '1.0.0',
              },
            },
          }));
          return;
        }

        if (method === 'notifications/initialized') {
          res.writeHead(204);
          res.end();
          return;
        }

        // Listing des outils
        if (method === 'tools/list') {
          const tools = await getCombinedToolsList();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: { tools },
          }));
          return;
        }

        // Exécution d'un outil
        if (method === 'tools/call') {
          const toolName = params?.name;
          const toolArgs = params?.arguments || {};
          const targetUserId = toolArgs.user_id || headerUserId || 'default';

          // 1. Outils d'authentification internes
          if (toolName.startsWith('auth_')) {
            const authResult = await handleAuthToolCall(toolName, toolArgs);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0', id, result: authResult }));
            return;
          }

          // 2. Outils Azure DevOps
          const worker = await getWorkerForUser(targetUserId);
          if (!worker) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              id,
              result: {
                content: [{
                  type: 'text',
                  text: `⚠️ Authentification requise : Aucun Personal Access Token (PAT) n'a été trouvé pour '${targetUserId}'. L'utilisateur doit s'authentifier au préalable via l'outil 'auth_register_token'.`
                }],
                isError: true,
              },
            }));
            return;
          }

          // Nettoyer user_id des arguments avant de transmettre au binaire officiel Microsoft
          const cleanedArgs = { ...toolArgs };
          delete cleanedArgs.user_id;

          const workerResponse = await worker.call('tools/call', {
            name: toolName,
            arguments: cleanedArgs,
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: workerResponse.result || workerResponse,
          }));
          return;
        }

        // Méthode non gérée
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Méthode non supportée : ${method}` },
        }));
      } catch (err) {
        console.error('[HTTP] Erreur traitement requête JSON-RPC:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32603, message: err.message },
        }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🚀 ADO-MCP Multi-Tenant Gateway démarré sur le port ${PORT}`);
  console.log(`🏢 Organisation cible : ${ORG_NAME}`);
  console.log(`🔐 Répertoire des données sécurisées : ${DATA_DIR}`);
  console.log(`=======================================================`);
});
