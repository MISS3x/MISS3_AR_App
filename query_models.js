const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8');
const url = env.match(/EXPO_PUBLIC_SUPABASE_URL=(.*)/)[1].trim();
const key = env.match(/EXPO_PUBLIC_SUPABASE_ANON_KEY=(.*)/)[1].trim();

fetch(`${url}/rest/v1/models_3d?select=id,title,storage_path`, {
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`
  }
})
.then(r => r.json())
.then(async data => {
  const crystal = data.find(m => m.id === '030f0ba6-960b-4427-941f-085394e5165e');
  if (crystal) {
    console.log("Found crystal:", crystal.storage_path);
    // Generate signed url
    const signRes = await fetch(`${url}/storage/v1/object/sign/models_secure/${crystal.storage_path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({ expiresIn: 3600 })
    });
    const { signedURL } = await signRes.json();
    console.log("Downloading from:", `${url}/storage/v1${signedURL}`);
    
    // Download
    const modelRes = await fetch(`${url}/storage/v1${signedURL}`);
    const buffer = await modelRes.arrayBuffer();
    
    // Ensure dir exists
    const dir = './assets/models';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    fs.writeFileSync(`${dir}/crystal_pbr.glb`, Buffer.from(buffer));
    console.log("Successfully saved to assets/models/crystal_pbr.glb");
  } else {
    console.log("Crystal model not found in DB.");
  }
})
.catch(err => console.error(err));
