import { readFileSync, writeFileSync } from 'node:fs';
import { createHash, createPublicKey, constants, sign, verify } from 'node:crypto';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Run only after the clean installer build and acceptance checks. Never changes production.
const [releaseDirectory, privateKeyPath] = process.argv.slice(2);
if (!releaseDirectory || !privateKeyPath) throw new Error('Usage: publish-update.mjs RELEASE_DIRECTORY PRIVATE_KEY_PATH');
const env = parse(readFileSync('.env.local'));
if (env.NEXT_PUBLIC_SUPABASE_URL !== 'https://syneonzucehwlghqmfbg.supabase.co') throw new Error('Staging storage required');
const build = JSON.parse(readFileSync(resolve(releaseDirectory, 'release-manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
if (!/^\d+\.\d+\.\d+$/.test(build.version) || build.unsigned !== true) throw new Error('Unexpected build');
const bytes = readFileSync(resolve(releaseDirectory, build.installer));
const sha256 = createHash('sha256').update(bytes).digest('hex');
if (sha256 !== build.installerSha256 || bytes.length !== build.installerBytes) throw new Error('Build hash mismatch');
const key = readFileSync(privateKeyPath, 'utf8');
const pinned = JSON.parse(readFileSync('lib/dealer-stock-sync/update-public-key.json', 'utf8'));
if (createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString().trim() !== pinned.pem.trim()) throw new Error('Signing key mismatch');
const fileName = `iTrader-Stock-Update-${build.version}.exe`;
const objectKey = `preview/${build.version}/${fileName}`;
const payload = Buffer.from(JSON.stringify({ version: build.version, channel: 'preview', objectKey, fileName, size: bytes.length, sha256 }));
const envelope = { payload: payload.toString('base64'), signature: sign('sha256', payload, { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }).toString('base64') };
const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const bucket = await client.storage.getBucket('stock-update-releases');
if (bucket.error || bucket.data.public || Number(bucket.data.file_size_limit) < bytes.length) throw new Error('Private bucket with sufficient file limit required');
const storage = client.storage.from('stock-update-releases');
const uploaded = await storage.upload(objectKey, bytes, { contentType: 'application/octet-stream', upsert: false, cacheControl: '31536000' });
if (uploaded.error && String(uploaded.error.statusCode) !== '409') throw new Error('Immutable installer upload failed');
const downloaded = await storage.download(objectKey);
if (downloaded.error || createHash('sha256').update(Buffer.from(await downloaded.data.arrayBuffer())).digest('hex') !== sha256) throw new Error('Stored installer verification failed');
let manifest = JSON.stringify(envelope);
const immutable = await storage.upload(`preview/${build.version}/manifest.json`, manifest, { contentType: 'application/json', upsert: false, cacheControl: '0' });
if (immutable.error) {
  if (String(immutable.error.statusCode) !== '409') throw new Error('Immutable manifest upload failed');
  const existing = await storage.download(`preview/${build.version}/manifest.json`);
  if (existing.error || existing.data.size > 16384) throw new Error('Existing manifest unavailable');
  manifest = await existing.data.text();
  const saved = JSON.parse(manifest);
  if (saved.payload !== envelope.payload || !verify('sha256', payload, { key: pinned.pem, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, Buffer.from(saved.signature, 'base64'))) throw new Error('Published manifest differs from this build');
}
const latest = await storage.upload('preview/latest.json', manifest, { contentType: 'application/json', upsert: true, cacheControl: '0' });
if (latest.error) throw new Error('Release activation failed');
const active = await storage.download('preview/latest.json');
if (active.error || await active.data.text() !== manifest) throw new Error('Active release verification failed');
writeFileSync(resolve(releaseDirectory, 'published.json'), JSON.stringify({ version: build.version, objectKey, sha256, size: bytes.length, publishedAt: new Date().toISOString(), productionTouched: false }, null, 2));
console.log(JSON.stringify({ version: build.version, objectKey, sha256, size: bytes.length, private: true }));
