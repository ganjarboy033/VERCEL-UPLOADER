import JSZip from 'jszip';
import crypto from 'node:crypto';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb'
    }
  }
};

const API = 'https://api.vercel.com';
const SKIP_PATH = /(^|\/)((__MACOSX\/)|(\.git\/)|(\.DS_Store$)|(\._)|(Thumbs\.db$))/i;

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
    name = `kruzen-site-${Date.now().toString(36)}`;
  }
  if (!/^[a-z0-9]/.test(name)) {
    name = `web-${name}`.slice(0, 63);
  }
  return name;
}

function cleanZipPath(input) {
  return String(input)
    .replace(/\\/g, '/')
    .split('/')
    .filter(part => part && part !== '.' && part !== '..')
    .map(part => part.replace(/[^\w.\- ]/g, '_').replace(/^\.+/, '') || '_')
    .slice(-8)
    .join('/');
}

function stripCommonRoot(files) {
  if (!files.length) return files;
  const parts = files.map(f => f.path.split('/'));
  const first = parts[0][0];
  const oneTopFolder =
    parts.every(p => p[0] === first) &&
    parts.some(p => p.length > 1) &&
    !files.some(f => !f.path.includes('/'));

  if (oneTopFolder) {
    for (const file of files) {
      file.path = file.path.split('/').slice(1).join('/');
    }
  }

  if (!files.some(f => f.path.toLowerCase() === 'index.html')) {
    const indexes = files.filter(f => /(^|\/)index\.html$/i.test(f.path));
    if (indexes.length) {
      const idx = indexes[0].path.lastIndexOf('/');
      const parent = idx !== -1 ? indexes[0].path.slice(0, idx) : '.';
      if (parent !== '.' && files.every(f => f.path.startsWith(parent + '/'))) {
        for (const file of files) {
          file.path = file.path.slice(parent.length + 1);
        }
      }
    }
  }
  return files;
}

async function uploadOne(token, teamId, file) {
  const sha = crypto.createHash('sha1').update(file.data).digest('hex');
  const url = new URL(`${API}/v2/files`);
  if (teamId) url.searchParams.set('teamId', teamId);

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

  if (!response.ok) {
    const body = await response.text();
    let detail = body;
    try {
      const parsed = JSON.parse(body);
      detail = parsed?.error?.message || parsed?.error || parsed?.message || body;
    } catch {}
    throw new Error(`Upload ${file.path} gagal (${response.status}): ${detail}`);
  }

  return {
    file: file.path,
    sha,
    size: file.data.length
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { token, teamId, projectName: rawProject, fileName, fileBase64, production } = req.body || {};

    if (!token) {
      return res.status(400).json({ error: 'VERCEL_TOKEN wajib diisi.' });
    }
    if (!fileBase64 || !fileName) {
      return res.status(400).json({ error: 'File ZIP atau HTML wajib dipilih.' });
    }

    // 1. Verifikasi Token
    const userRes = await fetch(`${API}/v2/user`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!userRes.ok) {
      return res.status(401).json({ error: 'VERCEL_TOKEN tidak valid atau sudah kedaluwarsa.' });
    }
    const userData = await userRes.json();
    const user = userData.user || userData;

    // 2. Ekstrak / Siapkan File
    const buffer = Buffer.from(fileBase64, 'base64');
    let files = [];

    if (/\.zip$/i.test(fileName)) {
      const zip = await JSZip.loadAsync(buffer);
      for (const [rawName, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        const clean = cleanZipPath(rawName);
        if (!clean || SKIP_PATH.test(clean)) continue;
        const data = await entry.async('nodebuffer');
        files.push({ path: clean, data });
      }
      files = stripCommonRoot(files);
    } else if (/\.html?$/i.test(fileName)) {
      files.push({
        path: 'index.html',
        data: buffer
      });
    } else {
      return res.status(400).json({ error: 'Format file harus .zip atau .html' });
    }

    if (!files.length) {
      return res.status(400).json({ error: 'Arsip ZIP kosong atau tidak berisi file valid.' });
    }

    const hasIndexHtml = files.some(f => f.path.toLowerCase() === 'index.html');
    const projectName = normalizeProjectName(
      rawProject || fileName.replace(/\.(zip|html?)$/i, '')
    );

    // 3. Upload semua file ke Vercel Storage
    const uploaded = [];
    for (const file of files) {
      const result = await uploadOne(token, teamId, file);
      uploaded.push(result);
    }

    // 4. Create Deployment
    const deployUrl = new URL(`${API}/v13/deployments`);
    deployUrl.searchParams.set('forceNew', '1');
    deployUrl.searchParams.set('skipAutoDetectionConfirmation', '1');
    if (teamId) deployUrl.searchParams.set('teamId', teamId);

    const payload = {
      name: projectName,
      files: uploaded,
      projectSettings: {
        framework: null
      }
    };
    if (production !== false) {
      payload.target = 'production';
    }

    const createRes = await fetch(deployUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const created = await createRes.json();
    if (!createRes.ok) {
      const msg = created?.error?.message || created?.message || 'Gagal membuat deployment.';
      return res.status(createRes.status).json({ error: msg });
    }

    const finalUrl = created.url ? `https://${created.url}` : `https://${projectName}.vercel.app`;
    const prodUrl = `https://${projectName}.vercel.app`;

    return res.status(200).json({
      success: true,
      account: user.username || user.email || user.id,
      projectName,
      deploymentId: created.id,
      readyState: created.readyState || 'QUEUED',
      url: finalUrl,
      productionUrl: prodUrl,
      fileCount: uploaded.length,
      hasIndexHtml
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Terjadi kesalahan server.' });
  }
}
