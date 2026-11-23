/**
 * ============================================================
 *                  XIYU CODEX - DEPLOY HTML ZIP
 * ============================================================
 *
 * PROJECT       : DEPLOY HTML ZIP
 * DEVELOPER     : XIYU CODEX
 * CREATED BY    : XIYU CODEX
 * VERSION       : 1.1.0
 * LICENSE       : Copyright Protected
 *
 * COPYRIGHT (C) 2026 XIYU CODEX
 * All Rights Reserved.
 *
 * ------------------------------------------------------------
 * DESCRIPTION
 * ------------------------------------------------------------
 *
 * DEPLOY HTML ZIP adalah tool Node.js untuk melakukan
 * deployment website statis ke platform Vercel.
 *
 * Mendukung input:
 * - Folder website.
 * - File HTML.
 * - Arsip ZIP.
 *
 * ------------------------------------------------------------
 * MAIN FEATURES
 * ------------------------------------------------------------
 *
 * - Deploy folder website.
 * - Deploy file HTML.
 * - Deploy arsip ZIP.
 * - Ekstraksi ZIP otomatis.
 * - Normalisasi struktur direktori.
 * - Validasi file dan ukuran upload.
 * - Upload melalui Vercel REST API.
 * - Validasi Vercel Access Token.
 * - Mendukung akun personal dan Team.
 * - Monitoring status deployment.
 * - Mendukung Production Deployment.
 *
 * ------------------------------------------------------------
 * UPLOAD LIMIT
 * ------------------------------------------------------------
 *
 * ZIP FILE       : 150 MiB
 * HTML FILE      : 150 MiB
 * INDIVIDUAL FILE: 150 MiB
 * TOTAL FILES    : 150 MiB
 * MAX FILE COUNT : 120
 *
 * CATATAN:
 * Batas lokal tidak mengubah batas maksimum Vercel API.
 *
 * ------------------------------------------------------------
 * REQUIREMENTS
 * ------------------------------------------------------------
 *
 * - Node.js 18+
 * - NPM
 * - Vercel Access Token
 * - Package: jszip
 *
 * INSTALLATION
 * ------------------------------------------------------------
 *
 * npm install jszip
 *
 * USAGE
 * ------------------------------------------------------------
 *
 * node deployhtmlzip.js ./website.zip nama-project
 *
 * node deployhtmlzip.js ./website nama-project
 *
 * node deployhtmlzip.js ./index.html nama-project
 *
 * node deployhtmlzip.js ./website.zip nama-project --production
 *
 * ENVIRONMENT VARIABLES
 * ------------------------------------------------------------
 *
 * VERCEL_TOKEN
 * VERCEL_TEAM_ID
 *
 * ------------------------------------------------------------
 * SECURITY NOTICE
 * ------------------------------------------------------------
 *
 * Pengguna bertanggung jawab menjaga kerahasiaan token.
 *
 * Jangan membagikan Vercel Access Token kepada publik.
 *
 * ============================================================
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const JSZip = require('jszip');

const API = 'https://api.vercel.com';

const MiB = 1024 * 1024;

const LIMITS = {
  files: 120,

  // Maksimal ukuran individual file.
  fileBytes: 150 * MiB,

  // Maksimal akumulasi seluruh file.
  totalBytes: 150 * MiB,

  // Maksimal arsip ZIP.
  zipBytes: 150 * MiB,

  faviconBytes: 1 * MiB
};

const SKIP_PATH =
  /(^|\/)(__MACOSX\/|\.git\/|\.DS_Store$|\._|Thumbs\.db$)/i;

// ============================================================
// PROJECT NAME
// ============================================================

function normalizeProjectName(input) {
  let name = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');

  if (!name) {
    throw new Error('Nama project tidak valid.');
  }

  if (!/^[a-z0-9]/.test(name)) {
    name = `web-${name}`.slice(0, 63);
  }

  return name;
}

// ============================================================
// FILE PATH
// ============================================================

function cleanZipPath(input) {
  return String(input)
    .replace(/\\/g, '/')
    .split('/')
    .filter(part =>
      part &&
      part !== '.' &&
      part !== '..'
    )
    .map(part =>
      part
        .replace(/[^\w.\- ]/g, '_')
        .replace(/^\.+/, '') || '_'
    )
    .slice(-8)
    .join('/');
}

function assertSafePath(filePath) {
  const normalized = String(filePath)
    .replace(/\\/g, '/');

  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[a-z]:/i.test(normalized) ||
    normalized.split('/').some(
      p => p === '..' || p === '.'
    )
  ) {
    throw new Error(
      `Path file tidak aman: ${filePath}`
    );
  }

  return normalized;
}

// ============================================================
// STRIP COMMON ROOT
// ============================================================

function stripCommonRoot(files) {
  if (!files.length) return files;

  const parts = files.map(
    file => file.path.split('/')
  );

  const first = parts[0][0];

  const oneTopFolder =
    parts.every(p => p[0] === first) &&
    parts.some(p => p.length > 1) &&
    !files.some(f => !f.path.includes('/'));

  if (oneTopFolder) {
    for (const file of files) {
      file.path = file.path
        .split('/')
        .slice(1)
        .join('/');
    }
  }

  if (
    !files.some(
      f => f.path.toLowerCase() === 'index.html'
    )
  ) {
    const indexes = files.filter(f =>
      /(^|\/)index\.html$/i.test(f.path)
    );

    if (indexes.length) {
      const parent = path.posix.dirname(
        indexes[0].path
      );

      if (
        parent !== '.' &&
        files.every(
          f => f.path.startsWith(parent + '/')
        )
      ) {
        for (const file of files) {
          file.path = file.path.slice(
            parent.length + 1
          );
        }
      }
    }
  }

  return files;
}

// ============================================================
// READ DIRECTORY
// ============================================================

async function readDirectory(dir) {
  const root = path.resolve(dir);
  const result = [];

  let total = 0;

  async function walk(current) {
    const entries = await fs.promises.readdir(
      current,
      { withFileTypes: true }
    );

    for (const ent of entries) {
      if (
        [
          '.git',
          'node_modules',
          '.vercel',
          '__MACOSX'
        ].includes(ent.name) ||
        ent.name === '.DS_Store' ||
        ent.name.startsWith('._')
      ) {
        continue;
      }

      const full = path.join(
        current,
        ent.name
      );

      if (ent.isDirectory()) {
        await walk(full);
        continue;
      }

      if (!ent.isFile()) continue;

      const stat = await fs.promises.stat(full);

      if (stat.size > LIMITS.fileBytes) {
        throw new Error(
          `File ${ent.name} melebihi 150 MiB.`
        );
      }

      total += stat.size;

      if (total > LIMITS.totalBytes) {
        throw new Error(
          'Total ukuran folder melebihi 150 MiB.'
        );
      }

      if (result.length >= LIMITS.files) {
        throw new Error(
          `Maksimal ${LIMITS.files} file.`
        );
      }

      const rel = path
        .relative(root, full)
        .split(path.sep)
        .join('/');

      result.push({
        path: assertSafePath(rel),
        data: await fs.promises.readFile(full)
      });
    }
  }

  await walk(root);

  return result;
}

// ============================================================
// READ ZIP
// ============================================================

async function readZip(zipPath) {
  const stat = await fs.promises.stat(zipPath);

  if (stat.size > LIMITS.zipBytes) {
    throw new Error(
      'Ukuran ZIP melebihi 150 MiB.'
    );
  }

  const buffer = await fs.promises.readFile(
    zipPath
  );

  const zip = await JSZip.loadAsync(buffer);

  const result = [];

  let total = 0;

  for (const [rawName, entry] of Object.entries(
    zip.files
  )) {
    if (entry.dir) continue;

    const clean = cleanZipPath(rawName);

    if (!clean || SKIP_PATH.test(clean)) {
      continue;
    }

    if (result.length >= LIMITS.files) {
      throw new Error(
        `Maksimal ${LIMITS.files} file dalam ZIP.`
      );
    }

    const data = await entry.async('nodebuffer');

    if (data.length > LIMITS.fileBytes) {
      throw new Error(
        `File ${clean} melebihi 150 MiB.`
      );
    }

    total += data.length;

    if (total > LIMITS.totalBytes) {
      throw new Error(
        'Total hasil ekstraksi ZIP melebihi 150 MiB.'
      );
    }

    result.push({
      path: assertSafePath(clean),
      data
    });
  }

  return stripCommonRoot(result);
}

// ============================================================
// VALIDATE FILES
// ============================================================

function validateFiles(files) {
  if (!files.length) {
    throw new Error(
      'Tidak ada file yang bisa di-deploy.'
    );
  }

  if (files.length > LIMITS.files) {
    throw new Error(
      `Maksimal ${LIMITS.files} file.`
    );
  }

  let total = 0;

  const seen = new Set();

  for (const file of files) {
    file.path = assertSafePath(file.path);

    if (seen.has(file.path)) {
      throw new Error(
        `Path duplikat: ${file.path}`
      );
    }

    seen.add(file.path);

    const size = file.data.length;

    if (size > LIMITS.fileBytes) {
      throw new Error(
        `File ${file.path} melebihi 150 MiB.`
      );
    }

    total += size;
  }

  if (total > LIMITS.totalBytes) {
    throw new Error(
      'Total ukuran file melebihi 150 MiB.'
    );
  }

  return {
    total,
    count: files.length
  };
}

// ============================================================
// API REQUEST
// ============================================================

async function request(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const detail =
      data?.error?.message ||
      data?.error ||
      data?.message ||
      text ||
      response.statusText;

    const err = new Error(
      `Vercel API ${response.status}: ${detail}`
    );

    err.status = response.status;
    err.data = data;

    throw err;
  }

  return data;
}

// ============================================================
// VERIFY TOKEN
// ============================================================

async function verifyToken(token) {
  const user = await request(
    `${API}/v2/user`,
    token
  );

  return user.user || user;
}

// ============================================================
// UPLOAD FILE
// ============================================================

async function uploadOne(token, file) {
  const sha = crypto
    .createHash('sha1')
    .update(file.data)
    .digest('hex');

  const url = new URL(
    `${API}/v2/files`
  );

  if (process.env.VERCEL_TEAM_ID) {
    url.searchParams.set(
      'teamId',
      process.env.VERCEL_TEAM_ID
    );
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(file.data.length),
      'x-vercel-digest': sha
    },
    body: file.data
  });

  const body = await response.text();

  if (!response.ok) {
    let detail = body;

    try {
      const parsed = JSON.parse(body);

      detail =
        parsed?.error?.message ||
        parsed?.error ||
        parsed?.message ||
        body;
    } catch {}

    throw new Error(
      `Upload ${file.path} gagal (${response.status}): ${detail}`
    );
  }

  return {
    file: file.path,
    sha,
    size: file.data.length
  };
}

// ============================================================
// CREATE DEPLOYMENT
// ============================================================

async function createDeployment(
  token,
  projectName,
  files,
  production
) {
  const url = new URL(
    `${API}/v13/deployments`
  );

  url.searchParams.set('forceNew', '1');

  url.searchParams.set(
    'skipAutoDetectionConfirmation',
    '1'
  );

  if (process.env.VERCEL_TEAM_ID) {
    url.searchParams.set(
      'teamId',
      process.env.VERCEL_TEAM_ID
    );
  }

  const payload = {
    name: projectName,
    files,
    projectSettings: {
      framework: null
    }
  };

  if (production) {
    payload.target = 'production';
  }

  return request(url, token, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
}

// ============================================================
// GET DEPLOYMENT
// ============================================================

async function getDeployment(token, id) {
  const url = new URL(
    `${API}/v13/deployments/${encodeURIComponent(id)}`
  );

  if (process.env.VERCEL_TEAM_ID) {
    url.searchParams.set(
      'teamId',
      process.env.VERCEL_TEAM_ID
    );
  }

  return request(url, token);
}

// ============================================================
// WAIT DEPLOYMENT
// ============================================================

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

async function waitForDeployment(
  token,
  deployment,
  options = {}
) {
  const timeoutMs =
    options.timeoutMs || 10 * 60 * 1000;

  const started = Date.now();

  let current = deployment;

  while (Date.now() - started < timeoutMs) {
    const state = String(
      current.readyState || ''
    ).toUpperCase();

    if (state === 'READY') {
      return current;
    }

    if (
      ['ERROR', 'CANCELED'].includes(state)
    ) {
      throw new Error(
        `Deployment ${state}: ${
          current.errorMessage ||
          current.errorCode ||
          'Tidak ada detail error.'
        }`
      );
    }

    await sleep(4000);

    current = await getDeployment(
      token,
      deployment.id
    );

    process.stdout.write(
      `\rStatus deployment: ${
        current.readyState || 'PROCESSING'
      }   `
    );
  }

  throw new Error(
    'Timeout menunggu deployment. Cek dashboard Vercel.'
  );
}

// ============================================================
// HIDDEN TOKEN INPUT
// ============================================================

function askHidden(question) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    if (
      !stdin.isTTY ||
      typeof stdin.setRawMode !== 'function'
    ) {
      const rl = readline.createInterface({
        input: stdin,
        output: stdout
      });

      rl.question(question, answer => {
        rl.close();
        resolve(answer.trim());
      });

      return;
    }

    stdout.write(question);

    let value = '';

    stdin.setRawMode(true);
    stdin.resume();

    const onData = chunk => {
      const key = chunk.toString('utf8');

      if (key === '\u0003') {
        cleanup();
        reject(new Error('Dibatalkan.'));
      } else if (
        key === '\r' ||
        key === '\n'
      ) {
        cleanup();
        stdout.write('\n');
        resolve(value.trim());
      } else if (
        key === '\u007f' ||
        key === '\b'
      ) {
        value = value.slice(0, -1);
      } else if (
        key >= ' ' &&
        key <= '~'
      ) {
        value += key;
      }
    };

    function cleanup() {
      stdin.removeListener(
        'data',
        onData
      );

      stdin.setRawMode(false);
      stdin.pause();
    }

    stdin.on('data', onData);
  });
}

// ============================================================
// MAIN DEPLOY FUNCTION
// ============================================================

async function deploy(
  inputPath,
  projectInput,
  options = {}
) {
  const token =
    options.token ||
    process.env.VERCEL_TOKEN ||
    await askHidden(
      'Masukkan Vercel Access Token (input disembunyikan): '
    );

  if (!token) {
    throw new Error(
      'Vercel token wajib diisi.'
    );
  }

  const abs = path.resolve(inputPath);

  const stat = await fs.promises.stat(abs);

  let files;

  if (stat.isDirectory()) {
    console.log('Membaca folder website...');

    files = await readDirectory(abs);

  } else if (
    stat.isFile() &&
    /\.zip$/i.test(abs)
  ) {
    console.log('Mengekstrak arsip ZIP...');

    files = await readZip(abs);

  } else if (stat.isFile()) {
    if (stat.size > LIMITS.fileBytes) {
      throw new Error(
        'File melebihi batas 150 MiB.'
      );
    }

    console.log('Membaca file...');

    files = [{
      path: path.basename(abs),
      data: await fs.promises.readFile(abs)
    }];

  } else {
    throw new Error(
      'Input harus berupa folder, file HTML, atau ZIP.'
    );
  }

  const summary = validateFiles(files);

  const projectName = normalizeProjectName(
    projectInput ||
    path.basename(
      abs,
      path.extname(abs)
    )
  );

  console.log('\nMemvalidasi token Vercel...');

  const user = await verifyToken(token);

  console.log(
    `Akun: ${
      user.username ||
      user.email ||
      user.id ||
      'terverifikasi'
    }`
  );

  console.log(`Project: ${projectName}`);

  console.log(
    `File: ${summary.count} | Total: ${
      (summary.total / MiB).toFixed(2)
    } MiB`
  );

  console.log(
    'Upload limit lokal: 150 MiB'
  );

  if (
    !files.some(
      f => f.path.toLowerCase() === 'index.html'
    )
  ) {
    console.log(
      'Peringatan: index.html tidak ditemukan di root.'
    );
  }

  const uploaded = [];

  for (
    let i = 0;
    i < files.length;
    i++
  ) {
    const file = files[i];

    process.stdout.write(
      `\rUpload ${i + 1}/${files.length}: ${file.path}`
    );

    uploaded.push(
      await uploadOne(token, file)
    );
  }

  console.log(
    '\nSemua file berhasil di-upload.'
  );

  console.log(
    'Membuat deployment...'
  );

  const created = await createDeployment(
    token,
    projectName,
    uploaded,
    !!options.production
  );

  console.log(
    `Deployment ID: ${created.id}`
  );

  console.log(
    `Status awal: ${
      created.readyState || 'QUEUED'
    }`
  );

  const ready = await waitForDeployment(
    token,
    created,
    {
      timeoutMs: options.timeoutMs
    }
  );

  const deployUrl = ready.url
    ? `https://${ready.url}`
    : created.url
      ? `https://${created.url}`
      : '';

  console.log(
    '\n\nDEPLOYMENT BERHASIL'
  );

  if (deployUrl) {
    console.log(`URL: ${deployUrl}`);
  }

  console.log(
    `Project: ${projectName}`
  );

  console.log(
    `ID: ${ready.id}`
  );

  return {
    success: true,
    projectName,
    url: deployUrl,
    deployment: ready,
    files: uploaded
  };
}

// ============================================================
// CLI
// ============================================================

async function main() {
  const args = process.argv.slice(2);

  if (
    !args.length ||
    args.includes('--help') ||
    args.includes('-h')
  ) {
    console.log(`
╔══════════════════════════════════════════╗
║       XIYU CODEX - DEPLOY HTML ZIP       ║
╚══════════════════════════════════════════╝

Usage:
  node deployhtmlzip.js <folder|file.html|file.zip> <project-name> [--production]

Upload Limits:
  ZIP FILE        : 150 MiB
  HTML FILE       : 150 MiB
  INDIVIDUAL FILE : 150 MiB
  TOTAL FILES     : 150 MiB
  MAX FILE COUNT  : 120

Environment:
  VERCEL_TOKEN
  VERCEL_TEAM_ID

Examples:
  node deployhtmlzip.js ./website.zip my-website

  node deployhtmlzip.js ./website my-website

  node deployhtmlzip.js ./index.html my-website

  node deployhtmlzip.js ./website.zip my-website --production

Note:
  Batas lokal tidak menjamin Vercel API menerima
  payload hingga 150 MiB.
`);

    return;
  }

  const input = args[0];

  const project = args.find(
    a =>
      !a.startsWith('--') &&
      a !== input
  );

  const production =
    args.includes('--production');

  await deploy(input, project, {
    production
  });
}

// ============================================================
// ENTRY POINT
// ============================================================

if (require.main === module) {
  main().catch(err => {
    console.error(
      `\nGAGAL: ${err.message}`
    );

    process.exitCode = 1;
  });
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  deploy,
  normalizeProjectName,
  cleanZipPath,
  readZip,
  readDirectory,
  validateFiles,
  LIMITS
};
